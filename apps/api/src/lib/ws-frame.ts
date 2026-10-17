import crypto from "node:crypto";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Compute the Sec-WebSocket-Accept key for RFC 6455 handshake.
 */
export function createWebSocketAcceptKey(clientKey: string): string {
  return crypto
    .createHash("sha1")
    .update(clientKey.trim() + WS_MAGIC)
    .digest("base64");
}

/**
 * Encode an unmasked WebSocket frame to send to client (RFC 6455 Section 5.1).
 */
export function encodeWsFrame(data: string | object, opcode = 0x01): Buffer {
  const payload = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
  const length = payload.length;
  let header: Buffer;

  if (length <= 125) {
    header = Buffer.from([0x80 | (opcode & 0x0f), length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Encode a WebSocket close frame (RFC 6455).
 */
export function encodeCloseFrame(code = 1000, reason = ""): Buffer {
  const reasonBuf = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  return encodeWsFrame(payload, 0x08);
}

/**
 * Encode a Pong frame.
 */
export function encodePongFrame(payload: Buffer = Buffer.alloc(0)): Buffer {
  return encodeWsFrame(payload, 0x0a);
}

export interface DecodedWsFrame {
  opcode: number;
  payload: Buffer;
  text?: string;
  isFinal: boolean;
}

/**
 * Decode WebSocket frames from incoming buffer, supporting both masked client frames
 * and unmasked frames.
 */
export function decodeWsFrames(buffer: Buffer): {
  frames: DecodedWsFrame[];
  remaining: Buffer;
} {
  const frames: DecodedWsFrame[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];

    const isFinal = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const isMasked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;

    let headerSize = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerSize = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerSize = 10;
    }

    const maskSize = isMasked ? 4 : 0;
    const totalSize = headerSize + maskSize + payloadLen;
    if (offset + totalSize > buffer.length) {
      break; // Incomplete frame
    }

    let payload = buffer.subarray(offset + headerSize + maskSize, offset + totalSize);
    if (isMasked) {
      const mask = buffer.subarray(offset + headerSize, offset + headerSize + 4);
      const unmasked = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    frames.push({
      opcode,
      payload,
      text: opcode === 1 ? payload.toString("utf8") : undefined,
      isFinal,
    });

    offset += totalSize;
  }

  return { frames, remaining: buffer.subarray(offset) };
}
