import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { query } from "../db";
import { config } from "../lib/config";
import { redis } from "../lib/redis";

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  revoked_at: string | null;
}

export function extractApiKey(req: Request): string | null {
  const customHeader = req.headers["x-api-key"];
  if (typeof customHeader === "string" && customHeader.trim()) {
    return customHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer bb_")) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export async function authenticateApiKey(
  apiKey: string,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<boolean> {
  // Enforce read-only access (GET, HEAD, OPTIONS only)
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(403).json({
      error: "Personal API keys are restricted to read-only endpoints",
      code: "API_KEY_READ_ONLY",
    });
    return true;
  }

  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const cacheKey = `apikey:hash:${hash}`;
  let cached = await redis.get(cacheKey).catch(() => null);

  let keyRow: ApiKeyRow | null = null;
  if (cached) {
    try {
      keyRow = JSON.parse(cached);
    } catch {
      keyRow = null;
    }
  }

  if (!keyRow) {
    const result = await query<ApiKeyRow>(
      `SELECT id, user_id, name, key_prefix, scopes, revoked_at
       FROM api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hash]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid or revoked API key", code: "INVALID_API_KEY" });
      return true;
    }
    keyRow = result.rows[0];
    await redis.set(cacheKey, JSON.stringify(keyRow), "EX", 300).catch(() => null);
  }

  // Update last_used_at asynchronously
  query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [keyRow.id]).catch(() => null);

  // Set req.user
  req.user = {
    sub: keyRow.user_id,
    email: "",
    role: "user",
    iss: config.JWT_ISSUER,
    aud: config.JWT_AUDIENCE,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    isApiKey: true,
    apiKeyId: keyRow.id,
  };

  next();
  return true;
}
