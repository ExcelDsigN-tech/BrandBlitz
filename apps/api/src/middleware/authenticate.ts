import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import { redis } from "../lib/redis";
import { extractApiKey, authenticateApiKey } from "./api-key-auth";

export interface AuthPayload {
  sub: string; // user ID
  email: string;
  role: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  isImpersonated?: boolean;
  impersonatedBy?: string;
  isApiKey?: boolean;
  apiKeyId?: string;
}

export function tokenRevocationKey(token: string): string {
  return `auth:revoked:${token}`;
}

export function tokenTtlSeconds(payload: { exp: number }): number {
  return Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Check for personal API key first
  const apiKey = extractApiKey(req);
  if (apiKey) {
    const handled = await authenticateApiKey(apiKey, req, res, next);
    if (handled) return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthPayload & {
      iss?: string;
      aud?: string;
    };

    if (payload.iss !== config.JWT_ISSUER || payload.aud !== config.JWT_AUDIENCE) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const revoked = await redis.get(tokenRevocationKey(token));
    if (revoked) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Server-side enforcement: Impersonated sessions cannot perform mutating actions
    if (payload.isImpersonated) {
      const isExit = req.path.endsWith("/impersonate-exit");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !isExit) {
        res.status(403).json({
          error: "Impersonated sessions cannot perform mutating actions (read-only mode)",
          code: "IMPERSONATION_READ_ONLY",
        });
        return;
      }
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = extractApiKey(req);
  if (apiKey) {
    try {
      const handled = await authenticateApiKey(apiKey, req, _res, next);
      if (handled) return;
    } catch {
      // ignore in optional auth
    }
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as AuthPayload & {
        iss?: string;
        aud?: string;
      };

      if (payload.iss !== config.JWT_ISSUER || payload.aud !== config.JWT_AUDIENCE) {
        next();
        return;
      }

      const revoked = await redis.get(tokenRevocationKey(token));
      if (!revoked) {
        req.user = payload;
      }
    } catch {
      // ignore — optional auth
    }
  }

  next();
}

export const authenticateOptional = optionalAuth;
