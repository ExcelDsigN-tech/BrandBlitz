import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import { redis } from "../lib/redis";
import { tokenRevocationKey, type AuthPayload } from "../middleware/authenticate";
import { query } from "../db";
import { logger } from "../lib/logger";
import {
  createWebSocketAcceptKey,
  encodeWsFrame,
  encodeCloseFrame,
  encodePongFrame,
  decodeWsFrames,
} from "../lib/ws-frame";

export const MAX_MESSAGE_LENGTH = 280;
export const RATE_LIMIT_MAX_MESSAGES = 5;
export const RATE_LIMIT_WINDOW_MS = 5000;
export const MAX_HISTORY_MESSAGES = 50;

/** Escape HTML special characters before broadcasting to prevent XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ChatMessage {
  id: string;
  challengeId: string;
  userId: string;
  username: string;
  displayName: string;
  content: string;
  timestamp: number;
}

export interface ChatClient {
  socket: Duplex;
  userId: string;
  username: string;
  displayName: string;
  messageTimestamps: number[];
}

export interface ChatRoom {
  challengeId: string;
  clients: Set<ChatClient>;
  history: ChatMessage[];
  endsAt: number;
  endTimer?: NodeJS.Timeout;
}

// In-memory room store. Never persisted to database.
const activeRooms = new Map<string, ChatRoom>();

/**
 * Get active room for a challenge.
 */
export function getChatRoom(challengeId: string): ChatRoom | undefined {
  return activeRooms.get(challengeId);
}

/**
 * Clear all rooms and timers (used for tests and server shutdown).
 */
export function resetChatRooms(): void {
  for (const room of activeRooms.values()) {
    if (room.endTimer) clearTimeout(room.endTimer);
    for (const client of room.clients) {
      try {
        client.socket.write(encodeCloseFrame(1001, "Server shutdown"));
        client.socket.end();
      } catch {
        // Ignore socket write errors during reset
      }
    }
    room.clients.clear();
  }
  activeRooms.clear();
}

/**
 * Send an encoded WebSocket frame to a client socket.
 */
export function sendWsMessage(socket: Duplex, data: object): void {
  if (socket.writable) {
    try {
      socket.write(encodeWsFrame(data));
    } catch (err) {
      logger.warn("Failed to write to WebSocket client", { err });
    }
  }
}

/**
 * Broadcast an event to all clients in a room (optionally excluding sender).
 */
export function broadcastToRoom(
  challengeId: string,
  data: object,
  excludeClient?: ChatClient
): void {
  const room = activeRooms.get(challengeId);
  if (!room) return;

  const frame = encodeWsFrame(data);
  for (const client of room.clients) {
    if (excludeClient && client === excludeClient) continue;
    if (client.socket.writable) {
      try {
        client.socket.write(frame);
      } catch {
        // Socket may have closed
      }
    }
  }
}

/**
 * Check if a client is rate-limited (5 messages per 5 seconds).
 */
export function isRateLimited(client: ChatClient, now = Date.now()): boolean {
  client.messageTimestamps = client.messageTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (client.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    return true;
  }
  client.messageTimestamps.push(now);
  return false;
}

/**
 * Close a room and disconnect all participants when a challenge ends.
 */
export function closeRoom(challengeId: string, reason = "Challenge ended"): void {
  const room = activeRooms.get(challengeId);
  if (!room) return;

  if (room.endTimer) {
    clearTimeout(room.endTimer);
  }

  // Notify clients that challenge ended
  const endNotice = encodeWsFrame({
    type: "challenge_ended",
    message: "Challenge has ended. Chat room is now closed.",
  });
  const closeFrame = encodeCloseFrame(1000, reason);

  for (const client of room.clients) {
    if (client.socket.writable) {
      try {
        client.socket.write(endNotice);
        client.socket.write(closeFrame);
        client.socket.end();
      } catch {
        // Socket may already be dead
      }
    }
  }

  room.clients.clear();
  activeRooms.delete(challengeId);
  logger.info("Chat room closed", { challengeId, reason });
}

function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  statusText: string,
  message?: string
): void {
  if (socket.writable) {
    const body = message || statusText;
    const response =
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n` +
      body;
    socket.write(response);
  }
  socket.destroy();
}

/**
 * Extract token from query params, Authorization header, or Sec-WebSocket-Protocol.
 */
function extractToken(req: IncomingMessage): string | null {
  const url = req.url || "";
  try {
    const parsedUrl = new URL(url, "http://localhost");
    const queryToken = parsedUrl.searchParams.get("token");
    if (queryToken) return queryToken;
  } catch {
    // Malformed url
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const protocolHeader = req.headers["sec-websocket-protocol"];
  if (protocolHeader) {
    // In browser WebSockets, token is often passed as a subprotocol
    const firstProtocol = protocolHeader.split(",")[0].trim();
    if (firstProtocol && !firstProtocol.includes(" ")) {
      return firstProtocol;
    }
  }

  return null;
}

/**
 * Primary WebSocket upgrade handler for challenge chat channels (#1036).
 */
export async function handleChatUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): Promise<void> {
  const url = req.url || "";
  const match = url.match(/^\/(?:api\/)?challenges\/([a-zA-Z0-9_\-]+)\/chat(?:\?.*)?$/);

  if (!match) {
    // Not a challenge chat path, ignore or reject
    rejectUpgrade(socket, 404, "Not Found", "Endpoint not found");
    return;
  }

  const challengeId = match[1];

  // 1. Authenticate upgrade via JWT & Redis revocation
  const token = extractToken(req);
  if (!token) {
    rejectUpgrade(socket, 401, "Unauthorized", "No token provided");
    return;
  }

  let authPayload: AuthPayload;
  try {
    const verified = jwt.verify(token, config.JWT_SECRET) as AuthPayload;
    if (verified.iss !== config.JWT_ISSUER || verified.aud !== config.JWT_AUDIENCE) {
      rejectUpgrade(socket, 401, "Unauthorized", "Invalid token issuer or audience");
      return;
    }
    authPayload = verified;
  } catch {
    rejectUpgrade(socket, 401, "Unauthorized", "Invalid or expired token");
    return;
  }

  const isRevoked = await redis.get(tokenRevocationKey(token)).catch(() => null);
  if (isRevoked) {
    rejectUpgrade(socket, 401, "Unauthorized", "Token has been revoked");
    return;
  }

  // 2. Fetch active user record
  const userResult = await query<{
    id: string;
    username: string;
    display_name: string;
  }>(
    `SELECT id, username, display_name
     FROM users
     WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
    [authPayload.sub]
  );

  const user = userResult.rows[0];
  if (!user) {
    rejectUpgrade(socket, 401, "Unauthorized", "User not found or inactive");
    return;
  }

  // 3. Verify challenge is active and not ended
  const challengeResult = await query<{
    id: string;
    status: string;
    ends_at: string;
  }>(
    `SELECT id, status, ends_at
     FROM challenges
     WHERE id = $1`,
    [challengeId]
  );

  const challenge = challengeResult.rows[0];
  if (!challenge) {
    rejectUpgrade(socket, 404, "Not Found", "Challenge not found");
    return;
  }

  const endsAtTime = new Date(challenge.ends_at).getTime();
  const now = Date.now();

  if (challenge.status !== "active") {
    rejectUpgrade(socket, 400, "Bad Request", "Challenge is not currently active");
    return;
  }

  if (endsAtTime <= now) {
    rejectUpgrade(socket, 400, "Bad Request", "Challenge has already ended");
    return;
  }

  // 4. Verify participant (game_sessions check for user_id and challenge_id)
  const sessionResult = await query(
    `SELECT 1
     FROM game_sessions
     WHERE user_id = $1 AND challenge_id = $2
     LIMIT 1`,
    [user.id, challengeId]
  );

  if (sessionResult.rows.length === 0) {
    rejectUpgrade(socket, 403, "Forbidden", "Only active challenge participants can access chat");
    return;
  }

  // 5. Complete RFC 6455 Handshake
  const clientKey = req.headers["sec-websocket-key"];
  if (!clientKey || typeof clientKey !== "string") {
    rejectUpgrade(socket, 400, "Bad Request", "Missing Sec-WebSocket-Key header");
    return;
  }

  const acceptKey = createWebSocketAcceptKey(clientKey);
  const protocolHeader = req.headers["sec-websocket-protocol"];
  const subprotocol =
    typeof protocolHeader === "string" ? protocolHeader.split(",")[0].trim() : null;

  let handshake =
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n`;

  if (subprotocol && !subprotocol.includes(" ")) {
    handshake += `Sec-WebSocket-Protocol: ${subprotocol}\r\n`;
  }
  handshake += "\r\n";

  socket.write(handshake);

  // 6. Initialize or join room
  let room = activeRooms.get(challengeId);
  if (!room) {
    const msUntilEnd = endsAtTime - now;
    const endTimer = setTimeout(
      () => {
        closeRoom(challengeId, "Challenge ended");
      },
      Math.max(100, msUntilEnd)
    );
    endTimer.unref();

    room = {
      challengeId,
      clients: new Set<ChatClient>(),
      history: [],
      endsAt: endsAtTime,
      endTimer,
    };
    activeRooms.set(challengeId, room);
  }

  const client: ChatClient = {
    socket,
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    messageTimestamps: [],
  };

  room.clients.add(client);

  logger.info("User joined challenge chat", {
    challengeId,
    userId: user.id,
    roomSize: room.clients.size,
  });

  // Send connected event and ephemeral history
  sendWsMessage(socket, {
    type: "connected",
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    count: room.clients.size,
  });

  sendWsMessage(socket, {
    type: "history",
    messages: room.history,
  });

  // Broadcast user_joined to others
  broadcastToRoom(
    challengeId,
    {
      type: "user_joined",
      username: user.username,
      displayName: user.display_name,
      count: room.clients.size,
    },
    client
  );

  // 7. Handle incoming WebSocket data frames
  let buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

  const cleanup = () => {
    const currentRoom = activeRooms.get(challengeId);
    if (currentRoom) {
      currentRoom.clients.delete(client);
      broadcastToRoom(challengeId, {
        type: "user_left",
        username: user.username,
        count: currentRoom.clients.size,
      });
      if (currentRoom.clients.size === 0 && currentRoom.endsAt <= Date.now()) {
        closeRoom(challengeId, "Empty ended room");
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, remaining } = decodeWsFrames(buffer);
    buffer = remaining;

    for (const frame of frames) {
      // Opcode 0x08: Close
      if (frame.opcode === 0x08) {
        if (socket.writable) {
          socket.write(encodeCloseFrame(1000, "Closed by client"));
          socket.end();
        }
        cleanup();
        return;
      }

      // Opcode 0x09: Ping
      if (frame.opcode === 0x09) {
        if (socket.writable) {
          socket.write(encodePongFrame(frame.payload));
        }
        continue;
      }

      // Opcode 0x01: Text Message
      if (frame.opcode === 0x01 && frame.text) {
        try {
          const payload = JSON.parse(frame.text);
          if (payload.type !== "chat") continue;

          // Rate limit enforcement
          if (isRateLimited(client)) {
            sendWsMessage(socket, {
              type: "error",
              code: "RATE_LIMITED",
              message: "Rate limit exceeded. Maximum 5 messages per 5 seconds.",
            });
            continue;
          }

          const rawContent = typeof payload.content === "string" ? payload.content.trim() : "";
          if (rawContent.length === 0 || rawContent.length > MAX_MESSAGE_LENGTH) {
            sendWsMessage(socket, {
              type: "error",
              code: "INVALID_LENGTH",
              message: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`,
            });
            continue;
          }

          const cleanContent = escapeHtml(rawContent);
          const message: ChatMessage = {
            id: crypto.randomUUID(),
            challengeId,
            userId: user.id,
            username: user.username,
            displayName: user.display_name,
            content: cleanContent,
            timestamp: Date.now(),
          };

          // Store in ephemeral in-memory history (never in DB)
          room.history.push(message);
          if (room.history.length > MAX_HISTORY_MESSAGES) {
            room.history.shift();
          }

          // Broadcast to all participants in this room
          broadcastToRoom(challengeId, {
            type: "chat",
            message,
          });
        } catch {
          sendWsMessage(socket, {
            type: "error",
            code: "INVALID_JSON",
            message: "Malformed JSON payload.",
          });
        }
      }
    }
  });

  socket.on("close", cleanup);
  socket.on("end", cleanup);
  socket.on("error", (err) => {
    logger.warn("Chat WebSocket error", { challengeId, userId: user.id, error: err.message });
    cleanup();
  });
}
