/**
 * Minimal RFC 8291 / RFC 8188 Web Push sender (issue #1009).
 *
 * The project deliberately avoids a runtime dependency on `web-push`; the
 * protocol is small and implemented with Node's built-in `crypto` + `fetch`:
 *
 *   - VAPID (RFC 8292): ES256 JWT sent in the `Authorization` header.
 *   - Payload encryption: ECDH P-256 + HKDF-SHA256 + AES-128-GCM with the
 *     `aes128gcm` content encoding.
 *
 * Payloads are intentionally tiny (title/body/url), so a single 4096-byte
 * record is always sufficient and no record splitting is implemented.
 */

import crypto from "crypto";
import { config } from "./config";
import { logger } from "./logger";

const VAPID_JWT_TTL_SECONDS = 12 * 60 * 60;
const DEFAULT_PUSH_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_RECORD_SIZE = 4096;
/** Push services reject payloads over 4 KB; leave headroom for headers/padding. */
const MAX_PAYLOAD_BYTES = 3_072;

export interface WebPushSubscriptionKeys {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface WebPushMessage {
  title: string;
  body: string;
  /** Relative URL opened when the notification is clicked. */
  url?: string;
  /** Collapses notifications with the same tag on the device. */
  tag?: string;
  notificationId?: string;
}

export interface WebPushResult {
  ok: boolean;
  statusCode?: number;
  /** True when the push service reports the subscription is gone (404/410). */
  expired: boolean;
  error?: string;
}

export interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Reject endpoints that would turn the notification worker into an SSRF proxy.
 * Push services are always public HTTPS origins; loopback, private ranges and
 * link-local addresses must never be called.
 */
export function isSafePushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  if (host === "[::1]" || host.endsWith(".internal")) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }

  return true;
}

export function base64UrlEncode(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

export function base64UrlDecode(input: string): Buffer {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(input)) {
    throw new Error("Invalid base64url value");
  }
  return Buffer.from(input, "base64url");
}

function toVapidPrivateKey(privateKey: string): crypto.KeyObject {
  // Operators may supply either a raw base64url scalar (the common case) or a
  // PEM-encoded P-256 key (e.g. generated with openssl).
  if (privateKey.includes("BEGIN")) {
    return crypto.createPrivateKey(privateKey);
  }

  const scalar = base64UrlDecode(privateKey);
  if (scalar.length !== 32) {
    throw new Error("VAPID private key must be a 32-byte base64url scalar");
  }

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const publicKey = ecdh.getPublicKey();

  return crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(scalar),
      x: base64UrlEncode(publicKey.subarray(1, 33)),
      y: base64UrlEncode(publicKey.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/** Derive the uncompressed public key (base64url) from the VAPID private key. */
export function deriveVapidPublicKey(privateKey: string): string {
  if (privateKey.includes("BEGIN")) {
    const publicKey = crypto.createPublicKey(crypto.createPrivateKey(privateKey)).export({
      format: "jwk",
    });
    if (!publicKey.x || !publicKey.y) {
      throw new Error("VAPID public key could not be derived from the configured key");
    }
    return base64UrlEncode(
      Buffer.concat([Buffer.from([4]), base64UrlDecode(publicKey.x), base64UrlDecode(publicKey.y)])
    );
  }

  const scalar = base64UrlDecode(privateKey);
  if (scalar.length !== 32) {
    throw new Error("VAPID private key must be a 32-byte base64url scalar");
  }
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  return base64UrlEncode(ecdh.getPublicKey());
}

export function getVapidCredentials(): VapidCredentials | null {
  const privateKey = config.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!privateKey) return null;

  try {
    return {
      privateKey,
      publicKey: config.WEB_PUSH_VAPID_PUBLIC_KEY ?? deriveVapidPublicKey(privateKey),
      subject: config.WEB_PUSH_VAPID_SUBJECT,
    };
  } catch (err) {
    logger.error("Invalid VAPID key configuration; web push disabled", { err });
    return null;
  }
}

export function isWebPushConfigured(): boolean {
  return getVapidCredentials() !== null;
}

export function getWebPushPublicKey(): string | null {
  return getVapidCredentials()?.publicKey ?? null;
}

export function buildVapidHeaders(
  credentials: VapidCredentials,
  endpoint: string,
  now = Date.now()
): Record<string, string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: Math.floor(now / 1000) + VAPID_JWT_TTL_SECONDS,
    sub: credentials.subject,
  };

  const signingInput = [
    base64UrlEncode(Buffer.from(JSON.stringify(header))),
    base64UrlEncode(Buffer.from(JSON.stringify(claims))),
  ].join(".");

  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: toVapidPrivateKey(credentials.privateKey),
    dsaEncoding: "ieee-p1363",
  });

  return {
    Authorization: `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${credentials.publicKey}`,
  };
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac("sha256", salt).update(ikm).digest();
}

/** Single-block HKDF-Expand, sufficient for the 32-byte maximum used here. */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return crypto
    .createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest()
    .subarray(0, length);
}

export interface EncryptedPushPayload {
  body: Buffer;
  headers: Record<string, string>;
}

/**
 * Encrypt a push payload for a subscription using the `aes128gcm` content
 * encoding (RFC 8188) and the Web Push key derivation from RFC 8291.
 */
export function encryptPushPayload(
  keys: WebPushSubscriptionKeys["keys"],
  message: WebPushMessage,
  recordSize = DEFAULT_RECORD_SIZE
): EncryptedPushPayload {
  const userAgentPublicKey = base64UrlDecode(keys.p256dh);
  if (userAgentPublicKey.length !== 65 || userAgentPublicKey[0] !== 0x04) {
    throw new Error("p256dh must be an uncompressed P-256 public key");
  }

  const authSecret = base64UrlDecode(keys.auth);
  if (authSecret.length < 16) {
    throw new Error("auth must be at least 16 bytes");
  }

  const localKeyPair = crypto.createECDH("prime256v1");
  localKeyPair.generateKeys();
  const applicationServerPublicKey = localKeyPair.getPublicKey();
  const sharedSecret = localKeyPair.computeSecret(userAgentPublicKey);

  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const ikm = hkdfExpand(
    prkKey,
    Buffer.concat([Buffer.from("WebPush: info\0"), userAgentPublicKey, applicationServerPublicKey]),
    32
  );

  const salt = crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  const plaintext = Buffer.concat([
    Buffer.from(JSON.stringify(message)),
    // 0x02 marks the last (and only) record, RFC 8188 §2.
    Buffer.from([0x02]),
  ]);

  if (plaintext.length + 16 > recordSize) {
    throw new Error("Push payload exceeds the maximum record size");
  }

  const headerBlock = Buffer.alloc(16 + 4 + 1 + applicationServerPublicKey.length);
  salt.copy(headerBlock, 0);
  headerBlock.writeUInt32BE(recordSize, 16);
  headerBlock.writeUInt8(applicationServerPublicKey.length, 20);
  applicationServerPublicKey.copy(headerBlock, 21);

  const cipher = crypto.createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  cipher.setAAD(headerBlock);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  return {
    body: Buffer.concat([headerBlock, ciphertext]),
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
  };
}

function isExpiredStatus(status: number): boolean {
  return status === 404 || status === 410;
}

export interface SendWebPushOptions {
  credentials?: VapidCredentials;
  ttlSeconds?: number;
  timeoutMs?: number;
  now?: number;
}

/**
 * Deliver a single push message. Never throws — the caller decides whether a
 * failure should prune the subscription.
 */
export async function sendWebPush(
  subscription: WebPushSubscriptionKeys,
  message: WebPushMessage,
  options: SendWebPushOptions = {}
): Promise<WebPushResult> {
  const credentials = options.credentials ?? getVapidCredentials();
  if (!credentials) {
    return { ok: false, expired: false, error: "push_not_configured" };
  }

  if (!isSafePushEndpoint(subscription.endpoint)) {
    return { ok: false, expired: false, error: "invalid_subscription" };
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(message));
  if (payloadSize > MAX_PAYLOAD_BYTES) {
    return { ok: false, expired: false, error: "payload_too_large" };
  }

  let encrypted: EncryptedPushPayload;
  let authorization: Record<string, string>;
  try {
    encrypted = encryptPushPayload(subscription.keys, message);
    authorization = buildVapidHeaders(credentials, subscription.endpoint, options.now);
  } catch (err) {
    logger.warn("Web push subscription rejected before delivery", {
      endpoint: subscription.endpoint,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, expired: false, error: "invalid_subscription" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        ...encrypted.headers,
        ...authorization,
        TTL: String(options.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS),
      },
      body: new Uint8Array(encrypted.body),
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, expired: false, statusCode: response.status };
    }

    return {
      ok: false,
      expired: isExpiredStatus(response.status),
      statusCode: response.status,
      error: `push_service_${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      expired: false,
      error: err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}
