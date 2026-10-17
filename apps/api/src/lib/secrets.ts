/**
 * secrets.ts — Docker secrets convention resolution.
 *
 * Supports the Docker secrets pattern where a secret is exposed to the
 * container via an environment variable named `<KEY>_FILE` pointing at a file
 * under `/run/secrets/`, whose contents should be used as the secret value.
 *
 * Plain environment variables (`<KEY>`) remain supported as a fallback for
 * local dev and non-Docker deployments. When both are present, the value read
 * from the `_FILE` path wins (this is the production posture: secrets mounted
 * as Docker secrets must not be visible as plain env vars).
 */

import { readFileSync } from "node:fs";

/**
 * Resolve a secret value for the given key.
 *
 * Resolution order:
 *  1. `<KEY>_FILE` — read + trim the secret from this file path (Docker secret).
 *  2. `<KEY>`       — plain environment variable (local dev / fallback).
 *
 * Returns `undefined` when no usable value is found (missing or blank), so
 * callers can let Zod validation report the gap with a clear error.
 */
export function resolveSecret(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const filePath = env[`${key}_FILE`];
  if (filePath) {
    try {
      const content = readFileSync(filePath, "utf8").trim();
      if (content) {
        return content;
      }
      console.warn(
        `⚠️ Secret file for ${key} at ${filePath} was empty — falling back to ${key} env var.`
      );
    } catch (err) {
      console.warn(
        `⚠️ Failed to read secret file for ${key} at ${filePath} — falling back to ${key} env var.`,
        { err: String(err) }
      );
    }
  }

  const value = env[key];
  return value && value.trim().length > 0 ? value : undefined;
}
