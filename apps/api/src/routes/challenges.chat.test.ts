import { Duplex } from "node:stream";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  handleChatUpgrade,
  getChatRoom,
  resetChatRooms,
  closeRoom,
  escapeHtml,
  isRateLimited,
  RATE_LIMIT_MAX_MESSAGES,
} from "./challenges.chat";
import {
  encodeWsFrame,
  decodeWsFrames,
  encodeCloseFrame,
} from "../lib/ws-frame";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  redisGet: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
  },
}));

vi.mock("../lib/config", () => ({
  config: {
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-that-is-at-least-32-chars-long", // gitleaks:allow
    JWT_ISSUER: "brandblitz-api",
    JWT_AUDIENCE: "brandblitz-client",
  },
}));

class MockDuplexSocket extends Duplex {
  public written: Buffer[] = [];
  public isDestroyed = false;
  public isEnded = false;

  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  _read() {}

  override destroy(error?: Error) {
    this.isDestroyed = true;
    super.destroy(error);
    return this;
  }

  override end(cb?: any) {
    this.isEnded = true;
    return super.end(cb);
  }

  getWrittenText(): string {
    return Buffer.concat(this.written).toString("utf8");
  }

  getDecodedFrames() {
    const raw = Buffer.concat(this.written);
    const headerEnd = raw.indexOf("\r\n\r\n");
    if (headerEnd === -1) return [];
    const wsBytes = raw.subarray(headerEnd + 4);
    const { frames } = decodeWsFrames(wsBytes);
    return frames;
  }
}

describe("Challenge Live Chat Channel (#1036)", () => {
  const challengeId = "challenge-123";
  const userId = "user-111";

  function createToken(sub = userId) {
    return jwt.sign(
      {
        sub,
        email: "player@example.com",
        role: "user",
        iss: "brandblitz-api",
        aud: "brandblitz-client",
      },
      "test-jwt-secret-that-is-at-least-32-chars-long", // gitleaks:allow
      { expiresIn: "1h" }
    );
  }

  function createUpgradeRequest(opts: {
    challengeId?: string;
    token?: string;
    customHeaders?: Record<string, string>;
  }) {
    const cid = opts.challengeId ?? challengeId;
    const token = opts.token ?? createToken();
    const headers: Record<string, string> = {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      authorization: `Bearer ${token}`,
      ...opts.customHeaders,
    };

    return {
      url: `/api/challenges/${cid}/chat?token=${token}`,
      headers,
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetChatRooms();
    mocks.redisGet.mockResolvedValue(null); // Token not revoked

    // Default mock database responses:
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("FROM users")) {
        return Promise.resolve({
          rows: [{ id: userId, username: "speedy_quizzer", display_name: "Speedy Quizzer" }],
        });
      }
      if (sql.includes("FROM challenges")) {
        return Promise.resolve({
          rows: [
            {
              id: challengeId,
              status: "active",
              ends_at: new Date(Date.now() + 3600000).toISOString(),
            },
          ],
        });
      }
      if (sql.includes("FROM game_sessions")) {
        return Promise.resolve({
          rows: [{ "?column?": 1 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => {
    resetChatRooms();
  });

  describe("escapeHtml", () => {
    it("escapes malicious HTML characters", () => {
      expect(escapeHtml("<script>alert(1)</script> & 'hello' \"world\"")).toBe(
        "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;hello&#39; &quot;world&quot;"
      );
    });
  });

  describe("Authentication & Participation Guards", () => {
    it("rejects upgrade when token is missing with 401", async () => {
      const socket = new MockDuplexSocket();
      const req = {
        url: `/api/challenges/${challengeId}/chat`,
        headers: {
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      } as any;

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.getWrittenText()).toContain("401 Unauthorized");
      expect(socket.isDestroyed).toBe(true);
    });

    it("rejects upgrade when token is revoked in Redis with 401", async () => {
      mocks.redisGet.mockResolvedValue("revoked");
      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.getWrittenText()).toContain("401 Unauthorized");
      expect(socket.getWrittenText()).toContain("Token has been revoked");
      expect(socket.isDestroyed).toBe(true);
    });

    it("rejects upgrade when user is not a participant with 403 Forbidden", async () => {
      // Mock game_sessions returning 0 rows
      mocks.query.mockImplementation((sql: string) => {
        if (sql.includes("FROM users")) {
          return Promise.resolve({
            rows: [{ id: userId, username: "outsider", display_name: "Outsider" }],
          });
        }
        if (sql.includes("FROM challenges")) {
          return Promise.resolve({
            rows: [
              {
                id: challengeId,
                status: "active",
                ends_at: new Date(Date.now() + 3600000).toISOString(),
              },
            ],
          });
        }
        if (sql.includes("FROM game_sessions")) {
          return Promise.resolve({ rows: [] }); // Not a participant
        }
        return Promise.resolve({ rows: [] });
      });

      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.getWrittenText()).toContain("403 Forbidden");
      expect(socket.getWrittenText()).toContain("Only active challenge participants can access chat");
      expect(socket.isDestroyed).toBe(true);
    });

    it("rejects upgrade when challenge is not active with 400 Bad Request", async () => {
      mocks.query.mockImplementation((sql: string) => {
        if (sql.includes("FROM users")) {
          return Promise.resolve({
            rows: [{ id: userId, username: "user", display_name: "User" }],
          });
        }
        if (sql.includes("FROM challenges")) {
          return Promise.resolve({
            rows: [
              {
                id: challengeId,
                status: "ended",
                ends_at: new Date(Date.now() - 1000).toISOString(),
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.getWrittenText()).toContain("400 Bad Request");
      expect(socket.isDestroyed).toBe(true);
    });
  });

  describe("Join, Handshake & Message Broadcasting", () => {
    it("completes RFC 6455 101 Switching Protocols handshake and sends connected event", async () => {
      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.getWrittenText()).toContain("HTTP/1.1 101 Switching Protocols");
      expect(socket.getWrittenText()).toContain("Sec-WebSocket-Accept:");

      const frames = socket.getDecodedFrames();
      expect(frames.length).toBeGreaterThanOrEqual(2);

      const welcome = JSON.parse(frames[0].text!);
      expect(welcome.type).toBe("connected");
      expect(welcome.username).toBe("speedy_quizzer");

      const history = JSON.parse(frames[1].text!);
      expect(history.type).toBe("history");
      expect(history.messages).toEqual([]);
    });

    it("broadcasts sent chat message to participants with escaped HTML", async () => {
      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      // Client sends chat message
      const clientMessage = JSON.stringify({
        type: "chat",
        content: "Great round! <3 & 'fun'!",
      });

      // Send masked frame as client
      socket.emit("data", encodeWsFrame(clientMessage));

      const room = getChatRoom(challengeId);
      expect(room).toBeDefined();
      expect(room?.history.length).toBe(1);
      expect(room?.history[0].content).toBe("Great round! &lt;3 &amp; &#39;fun&#39;!");

      const frames = socket.getDecodedFrames();
      const broadcastFrame = frames.find((f) => {
        try {
          const parsed = JSON.parse(f.text || "{}");
          return parsed.type === "chat";
        } catch {
          return false;
        }
      });

      expect(broadcastFrame).toBeDefined();
      const parsed = JSON.parse(broadcastFrame!.text!);
      expect(parsed.message.content).toBe("Great round! &lt;3 &amp; &#39;fun&#39;!");
      expect(parsed.message.username).toBe("speedy_quizzer");
    });
  });

  describe("Room Isolation", () => {
    it("does not leak messages across different challenge rooms", async () => {
      const socketA = new MockDuplexSocket();
      const socketB = new MockDuplexSocket();

      const reqA = createUpgradeRequest({ challengeId: "challenge-A" });
      const reqB = createUpgradeRequest({ challengeId: "challenge-B" });

      mocks.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes("FROM users")) {
          return Promise.resolve({
            rows: [{ id: userId, username: "userA", display_name: "User A" }],
          });
        }
        if (sql.includes("FROM challenges")) {
          return Promise.resolve({
            rows: [
              {
                id: params[0],
                status: "active",
                ends_at: new Date(Date.now() + 3600000).toISOString(),
              },
            ],
          });
        }
        if (sql.includes("FROM game_sessions")) {
          return Promise.resolve({ rows: [{ "?column?": 1 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await handleChatUpgrade(reqA, socketA, Buffer.alloc(0));
      await handleChatUpgrade(reqB, socketB, Buffer.alloc(0));

      // Send message to Room A
      socketA.emit(
        "data",
        encodeWsFrame(JSON.stringify({ type: "chat", content: "Secret to Room A only!" }))
      );

      const framesA = socketA.getDecodedFrames();
      const hasRoomAMessage = framesA.some((f) => f.text?.includes("Secret to Room A only!"));
      expect(hasRoomAMessage).toBe(true);

      const framesB = socketB.getDecodedFrames();
      const leakedToB = framesB.some((f) => f.text?.includes("Secret to Room A only!"));
      expect(leakedToB).toBe(false);
    });
  });

  describe("Rate Limiting & Message Length Enforcement", () => {
    it("rejects messages exceeding 280 characters with INVALID_LENGTH error", async () => {
      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      const longMessage = "a".repeat(281);
      socket.emit("data", encodeWsFrame(JSON.stringify({ type: "chat", content: longMessage })));

      const frames = socket.getDecodedFrames();
      const errorFrame = frames.find((f) => f.text?.includes("INVALID_LENGTH"));
      expect(errorFrame).toBeDefined();

      const room = getChatRoom(challengeId);
      expect(room?.history.length).toBe(0);
    });

    it("enforces rate limit of 5 messages per 5 seconds", async () => {
      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      // Send 5 messages quickly (allowed)
      for (let i = 1; i <= RATE_LIMIT_MAX_MESSAGES; i++) {
        socket.emit("data", encodeWsFrame(JSON.stringify({ type: "chat", content: `Msg ${i}` })));
      }

      const room = getChatRoom(challengeId);
      expect(room?.history.length).toBe(5);

      // Send 6th message (must trigger RATE_LIMITED error)
      socket.emit("data", encodeWsFrame(JSON.stringify({ type: "chat", content: "Msg 6" })));

      const frames = socket.getDecodedFrames();
      const rateLimitFrame = frames.find((f) => f.text?.includes("RATE_LIMITED"));
      expect(rateLimitFrame).toBeDefined();
      expect(room?.history.length).toBe(5); // Not added to history
    });
  });

  describe("Auto-Close When Challenge Ends", () => {
    it("notifies clients with challenge_ended event and closes room", async () => {
      const socket = new MockDuplexSocket();
      const req = createUpgradeRequest({});

      await handleChatUpgrade(req, socket, Buffer.alloc(0));

      expect(getChatRoom(challengeId)).toBeDefined();

      // Trigger room closure
      closeRoom(challengeId, "Challenge ended");

      expect(getChatRoom(challengeId)).toBeUndefined();

      const frames = socket.getDecodedFrames();
      const endNotice = frames.find((f) => f.text?.includes("challenge_ended"));
      expect(endNotice).toBeDefined();
      expect(socket.isEnded).toBe(true);
    });
  });
});
