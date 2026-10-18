import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildVapidHeaders,
  deriveVapidPublicKey,
  encryptPushPayload,
  isSafePushEndpoint,
  type VapidCredentials,
} from "./web-push";

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac("sha256", salt).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return crypto
    .createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest()
    .subarray(0, length);
}

function createVapidCredentials(): VapidCredentials {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: base64UrlEncode(ecdh.getPublicKey()),
    privateKey: base64UrlEncode(ecdh.getPrivateKey()),
    subject: "mailto:push@brandblitz.app",
  };
}

function publicKeyObject(uncompressed: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(uncompressed.subarray(1, 33)),
      y: base64UrlEncode(uncompressed.subarray(33, 65)),
    },
    format: "jwk",
  });
}

function decryptPushPayload(
  body: Buffer,
  userAgentKeys: crypto.ECDH,
  authSecret: Buffer
): Record<string, unknown> {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const applicationServerPublicKey = body.subarray(21, 21 + idLength);
  const headerBlock = body.subarray(0, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);

  const userAgentPublicKey = userAgentKeys.getPublicKey();
  const sharedSecret = userAgentKeys.computeSecret(applicationServerPublicKey);
  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const ikm = hkdfExpand(
    prkKey,
    Buffer.concat([Buffer.from("WebPush: info\0"), userAgentPublicKey, applicationServerPublicKey]),
    32
  );

  const prk = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);

  const decipher = crypto.createDecipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  decipher.setAAD(headerBlock);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  // Strip the RFC 8188 record delimiter (0x02 for the final record).
  const payload = plaintext.subarray(0, plaintext.length - 1);

  return JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
}

describe("base64url helpers", () => {
  it("round-trips binary data", () => {
    const input = crypto.randomBytes(65);
    expect(base64UrlDecode(base64UrlEncode(input)).equals(input)).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(() => base64UrlDecode("not valid!")).toThrow("Invalid base64url value");
  });
});

describe("VAPID", () => {
  it("derives the public key from a raw private key", () => {
    const credentials = createVapidCredentials();
    expect(deriveVapidPublicKey(credentials.privateKey)).toBe(credentials.publicKey);
  });

  it("signs an ES256 JWT for the push service origin", () => {
    const credentials = createVapidCredentials();
    const now = Date.UTC(2026, 0, 1);
    const { Authorization } = buildVapidHeaders(
      credentials,
      "https://fcm.googleapis.com/fcm/send/abc123",
      now
    );

    const match = Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match).not.toBeNull();

    const [, token, publicKey] = match!;
    expect(publicKey).toBe(credentials.publicKey);

    const [header, claims, signature] = token.split(".");
    const verified = crypto.verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKeyObject(base64UrlDecode(credentials.publicKey)), dsaEncoding: "ieee-p1363" },
      base64UrlDecode(signature)
    );
    expect(verified).toBe(true);

    const decodedHeader = JSON.parse(base64UrlDecode(header).toString("utf8"));
    const decodedClaims = JSON.parse(base64UrlDecode(claims).toString("utf8"));
    expect(decodedHeader).toMatchObject({ typ: "JWT", alg: "ES256" });
    expect(decodedClaims.aud).toBe("https://fcm.googleapis.com");
    expect(decodedClaims.sub).toBe("mailto:push@brandblitz.app");
    expect(decodedClaims.exp).toBe(Math.floor(now / 1000) + 12 * 60 * 60);
  });
});

describe("encryptPushPayload", () => {
  it("produces an aes128gcm body the subscriber can decrypt", () => {
    const userAgentKeys = crypto.createECDH("prime256v1");
    userAgentKeys.generateKeys();
    const authSecret = crypto.randomBytes(16);
    const message = {
      title: "Payout received",
      body: "You received 10.0000000 USDC",
      url: "/profile",
    };

    const { body, headers } = encryptPushPayload(
      {
        p256dh: base64UrlEncode(userAgentKeys.getPublicKey()),
        auth: base64UrlEncode(authSecret),
      },
      message
    );

    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);

    expect(decryptPushPayload(body, userAgentKeys, authSecret)).toEqual(message);
  });

  it("rejects malformed subscription keys", () => {
    expect(() =>
      encryptPushPayload({ p256dh: "abc", auth: "def" }, { title: "t", body: "b" })
    ).toThrow("p256dh must be an uncompressed P-256 public key");
  });
});

describe("isSafePushEndpoint", () => {
  it("allows public https push services", () => {
    expect(isSafePushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isSafePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/token")).toBe(
      true
    );
    expect(isSafePushEndpoint("https://8.8.8.8/push")).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost/push",
    "https://app.local/push",
    "https://127.0.0.1/push",
    "https://10.0.0.5/push",
    "https://172.16.0.5/push",
    "https://192.168.1.10/push",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@fcm.googleapis.com/push",
    "not-a-url",
  ])("rejects %s", (endpoint) => {
    expect(isSafePushEndpoint(endpoint)).toBe(false);
  });
});
