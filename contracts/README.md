# BrandBlitz Escrow — Soroban Smart Contract

A USDC escrow contract written in Rust for the Stellar Soroban smart contract platform. Brands deposit the prize pool; the BrandBlitz admin wallet settles payouts to winners or refunds the depositor if a challenge is cancelled.

---

## Table of Contents

- [Overview](#overview)
- [Contract Architecture](#contract-architecture)
- [Directory Structure](#directory-structure)
- [Prerequisites](#prerequisites)
- [Build](#build)
- [Test](#test)
- [Deploy to Testnet](#deploy-to-testnet)
- [Invoke Functions](#invoke-functions)
- [Contract Reference](#contract-reference)
  - [initialize](#initialize)
  - [deposit](#deposit)
  - [settle](#settle)
  - [refund](#refund)
  - [balance](#balance)
  - [is_settled](#is_settled)
  - [memo](#memo)
- [Storage Layout](#storage-layout)
- [Events](#events)
- [Security Considerations](#security-considerations)
- [Relationship to the Hot Wallet Model](#relationship-to-the-hot-wallet-model)

---

## Overview

The escrow contract holds USDC between a brand's deposit and the post-challenge payout. It provides a **trustless guarantee** to participants that the prize pool exists on-chain before the challenge goes live.

The contract is deployed once per challenge. The BrandBlitz platform:

1. Deploys a new escrow contract instance when a challenge is created
2. Provides the brand with the contract address to deposit USDC
3. Calls `settle()` after the challenge ends with the list of winners and their payout amounts
4. Optionally calls `refund()` if the challenge is cancelled before activation

---

## Contract Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Escrow Contract (Soroban)                   │
│                                                             │
│  Storage: Admin | Token | Memo | Depositor | Balance        │
│           Settled                                           │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ initialize() │  │  deposit()   │  │    settle()      │  │
│  │              │  │              │  │                  │  │
│  │ admin addr   │  │ brand sends  │  │ admin distributes│  │
│  │ token addr   │  │ USDC → here  │  │ USDC to winners  │  │
│  │ memo string  │  │              │  │ ≤ MAX recipients │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  refund()    │  │  balance()   │  │   is_settled()   │  │
│  │              │  │              │  │                  │  │
│  │ admin sends  │  │ view current │  │ view settled     │  │
│  │ USDC → brand │  │ USDC balance │  │ bool flag        │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                                      │
         ▼                                      ▼
  USDC SAC Contract                     Horizon / Events
  (Stellar Asset Contract)              (deposit/settled events)
```

---

## Directory Structure

```
contracts/
├── Cargo.toml                          # Workspace Cargo.toml
│                                       # soroban-sdk = "25" (workspace dep)
└── contracts/
    └── escrow/
        ├── Cargo.toml                  # Contract crate config
        ├── Makefile                    # Build / test / deploy shortcuts
        └── src/
            ├── lib.rs                  # Contract implementation
            └── test.rs                 # Integration tests (soroban testutils)
```

---

## Prerequisites

### Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

### Stellar CLI

```bash
cargo install --locked stellar-cli@25 --features opt
```

Verify:

```bash
stellar --version
# stellar 25.x.x
```

---

## Build

```bash
# From the contracts/ directory
cd contracts

# Build the contract to a WASM file
stellar contract build

# Output: contracts/escrow/target/wasm32-unknown-unknown/release/escrow.optimized.wasm

# Or using make
make build
```

The `Makefile` wraps the stellar CLI commands:

```bash
make build    # Build optimised WASM
make test     # Run unit + integration tests
make deploy   # Deploy to Stellar testnet (requires STELLAR_SECRET env var)
make clean    # Clean build artifacts
```

---

## Test

The test suite uses `soroban-sdk` testutils — a mock Stellar environment that runs entirely in-process. No network connection required.

```bash
cd contracts
cargo test
```

### Test Coverage

| Test                       | What it verifies                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `test_deposit_and_settle`  | Full happy path: initialize → deposit 100 USDC → settle to 2 winners → verify balances |
| `test_refund`              | Initialize → deposit → refund → depositor gets full balance back                       |
| `test_double_settle_fails` | Calling `settle()` twice panics with `"already settled"`                               |

Run with output:

```bash
cargo test -- --nocapture
```

---

## Deploy to Testnet

### 1. Configure Stellar CLI identity

```bash
# Create or import a keypair for the admin (hot wallet)
stellar keys generate admin --network testnet

# Or import from secret key
stellar keys add admin --secret-key <STELLAR_HOT_WALLET_SECRET>
```

### 2. Fund the account on testnet

```bash
stellar keys fund admin --network testnet
```

### 3. Deploy the contract

```bash
stellar contract deploy \
  --wasm contracts/escrow/target/wasm32-unknown-unknown/release/escrow.optimized.wasm \
  --source admin \
  --network testnet
```

This prints a **contract ID** (e.g. `CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`). Save it.

### 4. Initialize the contract

Replace the placeholders with real values:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address admin) \
  --token <USDC_SAC_ADDRESS_TESTNET> \
  --memo "BLITZ-A1B2C3"
```

Testnet USDC SAC address:
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

---

## Invoke Functions

### deposit

The brand must first increase the contract's USDC allowance:

```bash
# Approve the escrow contract to spend 100 USDC (7 decimal places)
stellar contract invoke \
  --id <USDC_SAC_ADDRESS> \
  --source brand-wallet \
  --network testnet \
  -- approve \
  --from $(stellar keys address brand-wallet) \
  --spender <CONTRACT_ID> \
  --amount 1000000000 \
  --expiration-ledger 99999999

# Deposit 100 USDC into escrow
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source brand-wallet \
  --network testnet \
  -- deposit \
  --depositor $(stellar keys address brand-wallet) \
  --amount 1000000000
```

### settle

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- settle \
  --recipients '[["G_WINNER_1_ADDRESS", 600000000], ["G_WINNER_2_ADDRESS", 400000000]]'
```

### refund

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- refund
```

### View balance

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- balance
```

---

## Contract Reference

### `initialize`

```rust
pub fn initialize(env: Env, admin: Address, token: Address, memo: String)
```

One-time setup. Must be called immediately after deployment before any other function.

| Parameter | Type      | Description                                                                     |
| --------- | --------- | ------------------------------------------------------------------------------- |
| `admin`   | `Address` | BrandBlitz hot wallet — the only address that can call `settle()` or `refund()` |
| `token`   | `Address` | Stellar Asset Contract (SAC) address for USDC on this network                   |
| `memo`    | `String`  | Unique challenge identifier (e.g. `BLITZ-A1B2C3`) for event correlation         |

Panics if called more than once (`"already initialized"`).

---

### `deposit`

```rust
pub fn deposit(env: Env, depositor: Address, amount: i128)
```

Transfers USDC from `depositor` into the contract. The depositor must have previously approved the contract to spend at least `amount` via the USDC SAC's `approve()` function.

| Parameter   | Type      | Description                                                           |
| ----------- | --------- | --------------------------------------------------------------------- |
| `depositor` | `Address` | Must sign the transaction (auth required)                             |
| `amount`    | `i128`    | Amount in USDC stroops (7 decimal places: `100 USDC = 1_000_000_000`) |

Emits a `deposited` event. Panics if `amount <= 0` or contract is already settled.

---

### `settle`

```rust
pub fn settle(env: Env, recipients: Vec<(Address, i128)>)
```

Distributes USDC to winners. Only `admin` can call this (auth required).

| Parameter    | Type                   | Description                            |
| ------------ | ---------------------- | -------------------------------------- |
| `recipients` | `Vec<(Address, i128)>` | List of (winner address, amount) pairs |

The sum of all recipient amounts must not exceed the current `balance`. Any remainder stays in the contract (gas reserve / rounding dust). Marks `settled = true`.

Emits a `settled` event. Panics if already settled or insufficient balance.

---

### `refund`

```rust
pub fn refund(env: Env)
```

Returns the full balance to the original depositor. Only `admin` can call this. Used when a challenge is cancelled.

Emits a `refunded` event. Panics if already settled or balance is zero.

---

### `balance`

```rust
pub fn balance(env: Env) -> i128
```

View function. Returns the current USDC balance held in the contract in stroops.

---

### `is_settled`

```rust
pub fn is_settled(env: Env) -> bool
```

View function. Returns `true` after `settle()` or `refund()` has been called.

---

### `memo`

```rust
pub fn memo(env: Env) -> String
```

View function. Returns the memo string set during `initialize()`.

---

## Storage Layout

The contract stores all state in Soroban **instance storage** (tied to the contract's lifecycle):

| Key                  | Type      | Description                      |
| -------------------- | --------- | -------------------------------- |
| `DataKey::Admin`     | `Address` | Authorised admin address         |
| `DataKey::Token`     | `Address` | USDC SAC contract address        |
| `DataKey::Memo`      | `String`  | Challenge memo identifier        |
| `DataKey::Depositor` | `Address` | Address that called `deposit()`  |
| `DataKey::Balance`   | `i128`    | Current escrowed USDC in stroops |
| `DataKey::Settled`   | `bool`    | Whether the escrow is closed     |

Instance storage is automatically archived with the contract. No persistent or temporary storage is used.

---

## Events

The contract emits Soroban events that can be subscribed to via the Soroban RPC `getEvents` method:

| Event topic      | Data                                 | Emitted by  |
| ---------------- | ------------------------------------ | ----------- |
| `("deposited",)` | `(depositor: Address, amount: i128)` | `deposit()` |
| `("settled",)`   | `total_distributed: i128`            | `settle()`  |
| `("refunded",)`  | `(depositor: Address, amount: i128)` | `refund()`  |

### Subscribing with the Stellar SDK

```typescript
import { rpc as SorobanRpc } from "@stellar/stellar-sdk/rpc";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

const events = await server.getEvents({
  startLedger: startLedger,
  filters: [
    {
      type: "contract",
      contractIds: [contractId],
      topics: [["deposited"]],
    },
  ],
});
```

---

## Security Considerations

### Admin-only settlement

`settle()` and `refund()` require `admin.require_auth()`. The admin address is set once at `initialize()` and cannot be changed. Only the BrandBlitz hot wallet private key can sign these calls.

### Double-settlement prevention

The `Settled` flag is checked at the start of both `settle()` and `refund()`. Once set to `true`, neither function can be called again.

### Deposit validation

`deposit()` uses `transfer()` on the USDC SAC — the funds move atomically. If the depositor has insufficient balance or hasn't approved the contract, the entire transaction reverts.

### Over-distribution prevention

`settle()` tracks `total_distributed` and panics if the sum would exceed the current `balance`.

### No upgrade mechanism

The contract has no `upgrade()` function. Once deployed and initialized, it cannot be modified. Each challenge gets a fresh deployment — this is intentional: it ensures each challenge's funds are fully isolated.

---

## Relationship to the Hot Wallet Model

BrandBlitz operates both a **hot wallet model** (default, off-chain) and this **Soroban escrow model** (on-chain, optional):

|                       | Hot Wallet                                  | Soroban Escrow             |
| --------------------- | ------------------------------------------- | -------------------------- |
| Prize pool location   | Hot wallet account                          | Contract instance          |
| Deposit detection     | Stellar RPC `getEvents` or Horizon payments | Contract `deposited` event |
| Payout mechanism      | Batch Payment ops (≤50/tx)                  | `settle(recipients)`       |
| On-chain transparency | Partial (payments visible)                  | Full (all state on-chain)  |
| Gas cost              | ~0.0007 XLM per batch                       | Deploy + invoke fees       |
| Requires Rust/Soroban | No                                          | Yes                        |

The hot wallet model is simpler to operate and is the default for new challenges. The Soroban contract provides a trustless alternative for brands that want full on-chain transparency.
