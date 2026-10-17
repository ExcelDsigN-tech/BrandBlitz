#!/usr/bin/env tsx
/**
 * rotate-hot-wallet.ts
 *
 * Zero-downtime Stellar hot-wallet rotation.
 *
 * What it does:
 *   1. Reads the current hot-wallet secret from the environment (HOT_WALLET_SECRET).
 *   2. Generates a fresh Stellar keypair.
 *   3. Funds the new account from the old wallet (createAccount + merge XLM).
 *   4. Sweeps any remaining USDC from old → new using a path-payment.
 *   5. Prints the new keypair so the operator can update .env / secret manager.
 *   6. Optionally updates a local .env file when --write-env is passed.
 *
 * Usage:
 *   pnpm tsx scripts/rotate-hot-wallet.ts [--network testnet|public] [--write-env]
 *
 * IMPORTANT:
 *   Run in staging first.  Review all printed transactions before running in prod.
 *   After running: update HOT_WALLET_SECRET + HOT_WALLET_PUBLIC_KEY in your secret
 *   manager / Docker secrets, then redeploy the API.
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Memo,
} from "@stellar/stellar-sdk";
import { Server as HorizonServer } from "@stellar/stellar-sdk/lib/horizon";
import * as fs from "fs";
import * as path from "path";

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const network = args.includes("--network")
  ? (args[args.indexOf("--network") + 1] ?? "testnet")
  : "testnet";
const writeEnv = args.includes("--write-env");

if (!["testnet", "public"].includes(network)) {
  console.error(`Unknown network: ${network}. Use "testnet" or "public".`);
  process.exit(1);
}

const NETWORK_PASSPHRASE = network === "public" ? Networks.PUBLIC : Networks.TESTNET;

const HORIZON_URL =
  network === "public" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (!process.env[key.trim()]) process.env[key.trim()] = value.trim();
    }
  }
}

function patchEnvFile(newPublic: string, newSecret: string): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.warn(".env not found — skipping file update. Set the vars manually.");
    return;
  }
  let content = fs.readFileSync(envPath, "utf8");
  content = content
    .replace(/^HOT_WALLET_PUBLIC_KEY=.*/m, `HOT_WALLET_PUBLIC_KEY=${newPublic}`)
    .replace(/^HOT_WALLET_SECRET=.*/m, `HOT_WALLET_SECRET=${newSecret}`);
  if (!content.includes("HOT_WALLET_PUBLIC_KEY=")) {
    content += `\nHOT_WALLET_PUBLIC_KEY=${newPublic}`;
  }
  if (!content.includes("HOT_WALLET_SECRET=")) {
    content += `\nHOT_WALLET_SECRET=${newSecret}`;
  }
  fs.writeFileSync(envPath, content, "utf8");
  console.log("✅  .env updated with new keypair.");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const oldSecret = process.env.HOT_WALLET_SECRET;
  if (!oldSecret) {
    console.error("HOT_WALLET_SECRET is not set. Aborting.");
    process.exit(1);
  }

  const oldKeypair = Keypair.fromSecret(oldSecret);
  const newKeypair = Keypair.random();

  console.log("\n=== BrandBlitz Hot-Wallet Rotation ===");
  console.log(`Network      : ${network}`);
  console.log(`Old public   : ${oldKeypair.publicKey()}`);
  console.log(`New public   : ${newKeypair.publicKey()}`);
  console.log(`New secret   : ${newKeypair.secret()}  ← store in secret manager`);
  console.log("");

  if (network === "public") {
    console.log("⚠️  PRODUCTION network selected. You have 10 seconds to abort (Ctrl-C).");
    await sleep(10_000);
  }

  const server = new HorizonServer(HORIZON_URL);

  // ── Step 1: Load old account ──────────────────────────────────────────────
  const oldAccount = await server.loadAccount(oldKeypair.publicKey());
  console.log("Loaded old account. Sequence:", oldAccount.sequenceNumber());

  const xlmBalance = oldAccount.balances.find((b) => b.asset_type === "native");
  const usdcBalance = oldAccount.balances.find(
    (b) => b.asset_type === "credit_alphanum4" && (b as any).asset_code === "USDC"
  );

  const xlmAmount = parseFloat(xlmBalance?.balance ?? "0");
  const usdcAmount = parseFloat(usdcBalance?.balance ?? "0");

  console.log(`Old XLM balance : ${xlmAmount}`);
  console.log(`Old USDC balance: ${usdcAmount}`);

  // ── Step 2: Fund new account (createAccount needs ≥1 XLM as reserve) ──────
  const startingBalance = Math.max(2, Math.floor(xlmAmount / 2)).toFixed(7);
  const tx1 = new TransactionBuilder(oldAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({
        destination: newKeypair.publicKey(),
        startingBalance,
      })
    )
    .addMemo(Memo.text("wallet-rotation-fund"))
    .setTimeout(60)
    .build();

  tx1.sign(oldKeypair);
  const result1 = await server.submitTransaction(tx1);
  console.log(`\n✅ Created new account. Tx: ${result1.hash}`);

  // ── Step 3: Sweep USDC old → new (if any) ────────────────────────────────
  if (usdcAmount > 0 && usdcBalance) {
    await sleep(5_000); // wait for ledger to close
    const freshOld = await server.loadAccount(oldKeypair.publicKey());

    const USDC_ISSUER =
      network === "public"
        ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    const usdc = new Asset("USDC", USDC_ISSUER);

    const tx2 = new TransactionBuilder(freshOld, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.changeTrust({
          asset: usdc,
          source: newKeypair.publicKey(),
        })
      )
      .addOperation(
        Operation.payment({
          destination: newKeypair.publicKey(),
          asset: usdc,
          amount: usdcAmount.toFixed(7),
        })
      )
      .addMemo(Memo.text("wallet-rotation-usdc"))
      .setTimeout(60)
      .build();

    tx2.sign(oldKeypair, newKeypair);
    const result2 = await server.submitTransaction(tx2);
    console.log(`✅ Swept ${usdcAmount} USDC to new wallet. Tx: ${result2.hash}`);
  }

  // ── Step 4: Merge remaining XLM old → new ────────────────────────────────
  await sleep(5_000);
  const freshOld2 = await server.loadAccount(oldKeypair.publicKey());

  const tx3 = new TransactionBuilder(freshOld2, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.accountMerge({
        destination: newKeypair.publicKey(),
      })
    )
    .addMemo(Memo.text("wallet-rotation-merge"))
    .setTimeout(60)
    .build();

  tx3.sign(oldKeypair);
  const result3 = await server.submitTransaction(tx3);
  console.log(`✅ Merged old account into new. Tx: ${result3.hash}`);

  // ── Step 5: Output / persist ──────────────────────────────────────────────
  console.log("\n=== ACTION REQUIRED ===");
  console.log("Update your secret manager / Docker secrets:");
  console.log(`  HOT_WALLET_PUBLIC_KEY = ${newKeypair.publicKey()}`);
  console.log(`  HOT_WALLET_SECRET     = ${newKeypair.secret()}`);
  console.log("Then redeploy the API + worker services.\n");

  if (writeEnv) {
    patchEnvFile(newKeypair.publicKey(), newKeypair.secret());
  }

  console.log("Rotation complete.");
}

main().catch((err) => {
  console.error("Rotation failed:", err?.response?.data ?? err);
  process.exit(1);
});
