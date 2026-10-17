/**
 * config.ts — Single source of truth for all runtime configuration.
 *
 * Validated via Zod at import time. If any required variable is missing or
 * malformed the process exits immediately with a human-readable error listing
 * every offending key and its expected format.
 *
 * Secrets are redacted in the startup log — only non-sensitive keys are shown.
 *
 * Closes #96
 */

import { ZodError } from "zod";
import { configSchema, type Config } from "./config-schema";
import { resolveSecret } from "./secrets";

// Keys whose values must never appear in logs.
const SECRET_KEYS = new Set<keyof Config>([
  "JWT_SECRET",
  "JWT_SECRET_PREVIOUS",
  "JWT_REFRESH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "HOT_WALLET_SECRET",
  "WEBHOOK_SECRET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "SESSION_INTEGRITY_KEY",
  "PHONE_HASH_SALT",
  "TWILIO_AUTH_TOKEN",
]);

function loadConfig(): Readonly<Config> {
  try {
    const parsed = configSchema.parse({
      ...process.env,
      // resolveSecret honours the Docker secrets convention: when
      // <KEY>_FILE=/run/secrets/... is set, the file contents win over the
      // plain env var (which compose blanks in prod).
      HOT_WALLET_SECRET:
        resolveSecret(process.env, "HOT_WALLET_SECRET") ?? process.env.STELLAR_HOT_WALLET_SECRET,
      S3_ACCESS_KEY_ID: resolveSecret(process.env, "S3_ACCESS_KEY_ID") ?? process.env.S3_ACCESS_KEY,
      S3_SECRET_ACCESS_KEY:
        resolveSecret(process.env, "S3_SECRET_ACCESS_KEY") ?? process.env.S3_SECRET_KEY,
      JWT_SECRET: resolveSecret(process.env, "JWT_SECRET"),
      GOOGLE_CLIENT_SECRET: resolveSecret(process.env, "GOOGLE_CLIENT_SECRET"),
      WEBHOOK_SECRET: resolveSecret(process.env, "WEBHOOK_SECRET"),
      // Support legacy env-var aliases so existing deployments keep working.
      TWILIO_SERVICE_SID: process.env.TWILIO_SERVICE_SID ?? process.env.TWILIO_VERIFY_SERVICE_SID,
    });

    // Log non-secret config values at startup so operators can verify what
    // the process actually loaded without exposing credentials.
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      redacted[k] = SECRET_KEYS.has(k as keyof Config) ? "[redacted]" : v;
    }
    console.info("✅ Config loaded", redacted);

    return Object.freeze(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return `  • ${path}: ${issue.message}`;
        })
        .join("\n");
      console.error(
        `❌ Invalid or missing environment variables:\n${details}\n` +
          `Check your .env file against .env.example for the expected format.`
      );
      process.exit(1);
    }
    throw error;
  }
}

export const config: Readonly<Config> = loadConfig();
