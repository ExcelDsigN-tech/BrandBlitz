/**
 * secrets.ts — Docker secrets (_FILE) resolution for the web app.
 *
 * The web service in docker-compose.prod.yml injects sensitive values as
 * Docker secrets and points `<KEY>_FILE` at the mounted file under
 * /run/secrets. Resolution prefers the file contents and falls back to the
 * plain environment variable so local dev (docker-compose.override.yml /
 * .env) keeps working unchanged.
 */

import { readFileSync } from "node:fs";

/**
 * Resolve a secret value for the given key.
 *
 * Resolution order:
 *  1. `<KEY>_FILE` — read + trim the secret from this file path (Docker secret).
 *  2. `<KEY>`       — plain environment variable (local dev / fallback).
 *
 * Returns `undefined` when no usable value is found.
 */
export function resolveSecret(name: string): string | undefined {
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      const content = readFileSync(filePath, "utf8").trim();
      if (content) {
        return content;
      }
      console.warn(
        `⚠️ Secret file for ${name} at ${filePath} was empty — falling back to ${name} env var.`
      );
    } catch (err) {
      console.warn(
        `⚠️ Failed to read secret file for ${name} at ${filePath} — falling back to ${name} env var.`,
        { err: String(err) }
      );
    }
  }

  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}
