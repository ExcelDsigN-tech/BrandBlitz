import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GITLEAKS_VERSION = "8.30.1";

function getPlatformAsset() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux" && arch === "x64")
    return `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;
  if (platform === "linux" && arch === "arm64")
    return `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`;
  if (platform === "darwin" && arch === "x64")
    return `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`;
  if (platform === "darwin" && arch === "arm64")
    return `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`;
  if (platform === "win32" && arch === "x64") return `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`;

  throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
}

function getBinaryName() {
  return process.platform === "win32" ? "gitleaks.exe" : "gitleaks";
}

function getCacheDir() {
  return join(process.cwd(), ".cache", "tools", "gitleaks", `v${GITLEAKS_VERSION}`);
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  await pipeline(res.body, createWriteStream(destPath));
}

async function ensureGitleaksBinary() {
  const cacheDir = getCacheDir();
  const binaryPath = join(cacheDir, getBinaryName());

  if (existsSync(binaryPath)) {
    const s = await stat(binaryPath);
    if (s.isFile() && s.size > 0) return binaryPath;
  }

  mkdirSync(cacheDir, { recursive: true });

  const asset = getPlatformAsset();
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}`;
  const tempArchive = join(tmpdir(), `brandblitz-gitleaks-${Date.now()}-${asset}`);

  await download(url, tempArchive);

  if (asset.endsWith(".tar.gz")) {
    await execFileAsync("tar", ["-xzf", tempArchive, "-C", cacheDir]);
  } else if (asset.endsWith(".zip")) {
    await execFileAsync("unzip", ["-o", tempArchive, "-d", cacheDir]);
  } else {
    throw new Error(`Unknown archive type for asset: ${asset}`);
  }

  if (!existsSync(binaryPath)) {
    throw new Error(
      `Downloaded archive did not contain ${getBinaryName()} at expected path: ${binaryPath}`
    );
  }

  if (process.platform !== "win32") {
    await chmod(binaryPath, 0o755);
  }

  return binaryPath;
}

async function main() {
  const binary = await ensureGitleaksBinary();
  const [, , cmd, ...args] = process.argv;

  if (!cmd) {
    console.error("Usage: pnpm gitleaks <command> [args...]");
    process.exit(2);
  }

  const { spawn } = await import("node:child_process");
  if (cmd === "pre-commit") {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--cached", "--no-color", "--unified=0"],
      { maxBuffer: 50 * 1024 * 1024 }
    );
    const additions = stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");

    if (!additions.trim()) return;

    const child = spawn(binary, ["detect", "--pipe", "--redact", "--config", ".gitleaks.toml"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", (err) => {
      console.error(err);
      process.exit(1);
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    child.stdin.end(additions);
    return;
  }

  const child = spawn(binary, [cmd, ...args], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
