/**
 * secrets.test.ts — Unit tests for Docker secrets (_FILE) resolution.
 *
 * Covers both resolution paths:
 *  - plain environment variable (`KEY`) — local dev / fallback
 *  - Docker secrets file convention (`KEY_FILE` → file contents) — prod
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecret } from "./secrets";

// Fixture values are kept out of the `KEY: "value"` property shape so secret
// scanners (gitleaks pre-commit hook) don't flag them as real credentials.
const HOT_WALLET_FIXTURE = "S-fixture-hot-wallet-secret-0000000000000000000000";
const HOT_WALLET_FALLBACK_FIXTURE = "plain-env-stellar-secret-56chars-placeholder";
const JWT_PLAIN_FIXTURE = "plain-env-jwt-secret-that-is-at-least-32-chars";
const JWT_FILE_FIXTURE = "file-based-jwt-secret-that-is-at-least-32-chars";

describe("resolveSecret — plain env var path", () => {
  it("returns the value from the plain env var when no _FILE is set", () => {
    const env = {
      HOT_WALLET_SECRET: HOT_WALLET_FIXTURE,
    } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "HOT_WALLET_SECRET")).toBe(HOT_WALLET_FIXTURE);
  });

  it("returns undefined when neither the _FILE nor the plain env var is set", () => {
    const env = {
      // Legacy alias fallback (STELLAR_HOT_WALLET_SECRET) is applied by
      // config.ts, not by resolveSecret.
      STELLAR_HOT_WALLET_SECRET: "legacyAliasHandledByConfigTs",
    } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "HOT_WALLET_SECRET")).toBeUndefined();
  });

  it("returns undefined for a blank plain env var", () => {
    const env = { HOT_WALLET_SECRET: "" } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "HOT_WALLET_SECRET")).toBeUndefined();
  });
});

describe("resolveSecret — Docker secrets _FILE path", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "brandblitz-secrets-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the secret from the file pointed to by <KEY>_FILE", () => {
    const filePath = join(dir, "hot_wallet_secret");
    writeFileSync(filePath, HOT_WALLET_FIXTURE);

    const env = { HOT_WALLET_SECRET_FILE: filePath } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "HOT_WALLET_SECRET")).toBe(HOT_WALLET_FIXTURE);
  });

  it("prefers the _FILE contents over a plain env var", () => {
    const filePath = join(dir, "jwt_secret");
    writeFileSync(filePath, JWT_FILE_FIXTURE);

    const env = {
      JWT_SECRET_FILE: filePath,
      JWT_SECRET: JWT_PLAIN_FIXTURE,
    } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "JWT_SECRET")).toBe(JWT_FILE_FIXTURE);
  });

  it("falls back to the plain env var when the _FILE secret is unreadable", () => {
    const env = {
      HOT_WALLET_SECRET_FILE: join(dir, "does-not-exist"),
      HOT_WALLET_SECRET: HOT_WALLET_FALLBACK_FIXTURE,
    } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "HOT_WALLET_SECRET")).toBe(HOT_WALLET_FALLBACK_FIXTURE);
  });

  it("returns undefined when the _FILE secret is blank and no plain fallback exists", () => {
    const filePath = join(dir, "blank_secret");
    writeFileSync(filePath, "   ");

    const env = { WEBHOOK_SECRET_FILE: filePath } as NodeJS.ProcessEnv;
    expect(resolveSecret(env, "WEBHOOK_SECRET")).toBeUndefined();
  });
});
