/**
 * secrets.test.ts — regression tests for Docker secrets (_FILE) resolution in
 * the web app: both the plain env var path (local dev) and the _FILE path
 * (prod, /run/secrets mount).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecret } from "./secrets";

const KEYS = ["NEXTAUTH_SECRET", "NEXTAUTH_SECRET_FILE"] as const;

describe("resolveSecret (web)", () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), "brandblitz-web-secrets-test-"));
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the plain env var when no _FILE variant is set", () => {
    process.env.NEXTAUTH_SECRET = "plain-env-nextauth-secret-32chars!!";
    expect(resolveSecret("NEXTAUTH_SECRET")).toBe("plain-env-nextauth-secret-32chars!!");
  });

  it("reads the secret from the file pointed to by <KEY>_FILE", () => {
    const filePath = join(dir, "nextauth_secret");
    writeFileSync(filePath, "file-based-nextauth-secret-32chars!!");
    process.env.NEXTAUTH_SECRET_FILE = filePath;

    expect(resolveSecret("NEXTAUTH_SECRET")).toBe("file-based-nextauth-secret-32chars!!");
  });

  it("prefers the _FILE contents over a plain env var", () => {
    const filePath = join(dir, "nextauth_secret");
    writeFileSync(filePath, "file-based-nextauth-secret-32chars!!");
    process.env.NEXTAUTH_SECRET_FILE = filePath;
    process.env.NEXTAUTH_SECRET = "plain-env-nextauth-secret-32chars!!";

    expect(resolveSecret("NEXTAUTH_SECRET")).toBe("file-based-nextauth-secret-32chars!!");
  });

  it("falls back to the plain env var when the _FILE secret is unreadable", () => {
    process.env.NEXTAUTH_SECRET_FILE = join(dir, "does-not-exist");
    process.env.NEXTAUTH_SECRET = "plain-env-nextauth-secret-32chars!!";

    expect(resolveSecret("NEXTAUTH_SECRET")).toBe("plain-env-nextauth-secret-32chars!!");
  });

  it("treats a blank plain env var as unset", () => {
    process.env.NEXTAUTH_SECRET = "";
    expect(resolveSecret("NEXTAUTH_SECRET")).toBeUndefined();
  });
});
