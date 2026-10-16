# Runbook: Secret Rotation

This is the single source of truth for rotating BrandBlitz secrets. It
replaces the former `secrets-rotation.md`, which used different env var names
and cadences (#952).

Environment variable names below match `apps/api/src/lib/config-schema.ts`
and [docs/deployment/required-env.md](../deployment/required-env.md). If you
add a secret there, add it here too.

> **Tabletop exercise**: schedule quarterly (last week of each calendar quarter).
> Verify every section end-to-end in staging, then confirm steps are still accurate.
> Next exercise: **2026-Q4** (week of 2026-12-21).

---

## Secret inventory

Each secret has exactly one cadence. "On leak" means rotate immediately via
[leaked-secret.md](leaked-secret.md), regardless of the schedule.

| Secret                                | Environment variable    | Consumers            | Store                  | Cadence                                     |
| ------------------------------------- | ----------------------- | -------------------- | ---------------------- | ------------------------------------------- |
| JWT access-token signing secret       | `JWT_SECRET`            | api                  | Docker secret / `.env` | Every 90 days, or on leak                   |
| JWT refresh-token signing secret      | `JWT_REFRESH_SECRET`    | api                  | Docker secret / `.env` | Every 90 days with `JWT_SECRET`, or on leak |
| Previous JWT secret (rotation window) | `JWT_SECRET_PREVIOUS`   | api                  | Docker secret / `.env` | Cleared 15 min after each JWT rotation      |
| Google OAuth client secret            | `GOOGLE_CLIENT_SECRET`  | api, web             | Docker secret / `.env` | Every 180 days, or on leak                  |
| Stellar hot-wallet secret             | `HOT_WALLET_SECRET`     | api, payout worker   | Docker secret / `.env` | Every 60 days, or on leak                   |
| Stellar hot-wallet public key         | `HOT_WALLET_PUBLIC_KEY` | api, payout worker   | Docker secret / `.env` | Changes with `HOT_WALLET_SECRET`            |
| Webhook HMAC secret                   | `WEBHOOK_SECRET`        | api, deposit-monitor | Docker secret / `.env` | Every 90 days, or on leak                   |
| Postgres password                     | `DATABASE_URL`          | api, deposit-monitor | Docker secret / `.env` | Every 90 days, or on leak                   |
| Session integrity key                 | `SESSION_INTEGRITY_KEY` | api, payout worker   | Docker secret / `.env` | Every 90 days, or on leak                   |
| Phone hash salt                       | `PHONE_HASH_SALT`       | api                  | Docker secret / `.env` | On leak only (see section 9)                |
| MinIO / S3 access key                 | `S3_ACCESS_KEY_ID`      | api                  | Docker secret          | Every 90 days, or on leak                   |
| MinIO / S3 secret key                 | `S3_SECRET_ACCESS_KEY`  | api                  | Docker secret          | Every 90 days, or on leak                   |
| Twilio auth token                     | `TWILIO_AUTH_TOKEN`     | api                  | Docker secret / `.env` | Every 180 days, or on leak                  |
| Twilio account SID                    | `TWILIO_ACCOUNT_SID`    | api                  | Docker secret / `.env` | Identifier, not rotated                     |
| Twilio Verify service SID             | `TWILIO_SERVICE_SID`    | api                  | Docker secret / `.env` | Identifier, not rotated                     |
| Slack webhook URL                     | `SLACK_WEBHOOK_URL`     | CI                   | GitHub secret          | On leak only                                |
| SSH deploy key                        | `PROD_SSH_KEY`          | CI                   | GitHub secret          | Annually, or on leak                        |

### Legacy alias

`STELLAR_HOT_WALLET_SECRET` is a deprecated alias. `apps/api/src/lib/config.ts`
reads it only when `HOT_WALLET_SECRET` is unset. Always write
`HOT_WALLET_SECRET`; when you rotate, delete any `STELLAR_HOT_WALLET_SECRET`
left in the environment so the two can't drift.

---

## Before any rotation

- [ ] You have write access to the secret store (Docker secrets, GitHub Secrets).
- [ ] All services are healthy and alerting is active.
- [ ] The team is notified in #ops with the planned window.
- [ ] You're rotating during a low-traffic window.
- [ ] You know the current value, so you can roll back.

---

## 1. JWT secrets (zero-downtime dual-verify rotation)

Access tokens have a 15-minute TTL (`ACCESS_TOKEN_TTL` in
`apps/api/src/lib/tokens.ts`). The API supports a **dual-verify window**:
tokens signed with the _old_ secret are still accepted while
`JWT_SECRET_PREVIOUS` is set, so users aren't forced to sign out.

1. Generate a new secret (at least 32 characters, enforced by the config schema):

   ```bash
   NEW_JWT=$(openssl rand -base64 48)
   echo "$NEW_JWT"
   ```

2. Deploy with both secrets active:
   - Set `JWT_SECRET_PREVIOUS` = current `JWT_SECRET`.
   - Set `JWT_SECRET` = `$NEW_JWT`.
   - Redeploy the API.

   `verifyAccessToken` in `apps/api/src/lib/tokens.ts` tries the new secret
   first, then falls back to `JWT_SECRET_PREVIOUS`.

3. Wait 15 minutes (access-token TTL). All live access tokens are now signed
   with the new secret.

4. Unset `JWT_SECRET_PREVIOUS` and redeploy (a rolling restart is fine).

5. Verify:

   ```bash
   curl -f https://brandblitz.io/api/health
   # Check sign-in and token refresh in staging first.
   ```

`JWT_REFRESH_SECRET` signs refresh tokens (30-day TTL) and falls back to
`JWT_SECRET` when unset. It has no dual-verify window, so rotating it signs
everyone out on their next refresh. Either accept that, or force the sign-out
deliberately first with [session-forced-signout.md](session-forced-signout.md).

Rollback: restore the previous `JWT_SECRET` value and redeploy.

---

## 2. Stellar hot-wallet secret (`HOT_WALLET_SECRET`)

Run the automated rotation script:

```bash
# Dry-run on testnet first
pnpm tsx scripts/rotate-hot-wallet.ts --network testnet

# Production (requires HOT_WALLET_SECRET in env; 10-second abort window)
pnpm tsx scripts/rotate-hot-wallet.ts --network public
```

The script:

1. Generates a fresh keypair.
2. Funds the new account from the old wallet.
3. Sweeps remaining USDC old to new.
4. Merges (closes) the old account, so all remaining XLM moves to the new wallet.
5. Prints the new `HOT_WALLET_PUBLIC_KEY` / `HOT_WALLET_SECRET` to update.

After the script succeeds:

1. Update `HOT_WALLET_SECRET` and `HOT_WALLET_PUBLIC_KEY` in the secret store,
   and remove any `STELLAR_HOT_WALLET_SECRET`.
2. Redeploy the API and payout worker.
3. Confirm no payouts are orphaned in the queue
   (see [payout-stuck-in-queue.md](payout-stuck-in-queue.md)).
4. Run a small test payout and watch payouts for 24 hours.

See [scripts/rotate-hot-wallet.ts](../../scripts/rotate-hot-wallet.ts) for full
details, and [hot-wallet-low-balance.md](hot-wallet-low-balance.md) if the new
wallet needs topping up.

---

## 3. Google OAuth client secret (`GOOGLE_CLIENT_SECRET`)

1. Open [Google Cloud Console, APIs & Services, Credentials](https://console.cloud.google.com/apis/credentials).
2. Select the BrandBlitz OAuth 2.0 client.
3. Add a new secret and copy the value (Google shows it once).
4. Update `GOOGLE_CLIENT_SECRET` in the secret store.
5. Redeploy the API and web apps.
6. Validate the OAuth login flow in staging, then prod.
7. Disable and delete the old secret in Google Cloud Console.

Rollback: re-enable the old secret in the console, revert the env var, redeploy.

---

## 4. S3 / MinIO credentials

Follow [rotate-s3-credentials.md](rotate-s3-credentials.md) for the full procedure.

---

## 5. Twilio auth token (`TWILIO_AUTH_TOKEN`)

1. Log in to [Twilio Console](https://console.twilio.com).
2. Create a secondary auth token (Account, API keys & tokens).
3. Update `TWILIO_AUTH_TOKEN` in the secret store and redeploy the API.
4. Validate the SMS verification flow.
5. Promote the secondary token to primary in Twilio, which retires the old one.

Rollback: until step 5 the old token still works. Revert the env var and redeploy.

---

## 6. Webhook HMAC secret (`WEBHOOK_SECRET`)

The deposit-monitor signs `POST /webhooks/stellar/deposit` with this secret,
and `apps/api/src/middleware/verify-webhook.ts` verifies it. The middleware
prefers `webhook_secret_current` (and an unexpired `webhook_secret_pending`)
from the `app_config` table, and falls back to the env var only when no DB
value exists. Check which one is live before rotating:

```sql
SELECT key FROM app_config WHERE key LIKE 'webhook_secret_%';
```

1. Generate: `NEW_WH=$(openssl rand -hex 32)`.
2. If the DB keys exist, write `NEW_WH` as `webhook_secret_pending` with an
   `expiresAt` an hour out, so both secrets verify during the switch.
3. Update `WEBHOOK_SECRET` for the API and deposit-monitor and redeploy both.
4. Promote the new value to `webhook_secret_current` and delete the pending row.
5. Confirm deposits still land (watch for 401s on `/webhooks/stellar/deposit`).

Rollback: restore the old value in both services (and the DB row) and redeploy.

---

## 7. Postgres password (`DATABASE_URL`)

1. Set a new password on the app role:

   ```sql
   ALTER ROLE brandblitz WITH PASSWORD '<new-password>';
   ```

   Postgres keeps one password per role, so existing pooled connections keep
   working but new ones need the new value. Move fast through the next step.

2. Test it: `psql "postgresql://brandblitz:<new-password>@<host>:5432/brandblitz" -c "SELECT 1"`.
3. Update `DATABASE_URL` for the API and deposit-monitor, then redeploy both.
4. Watch logs for connection or pool errors.

Rollback: `ALTER ROLE` back to the old password and redeploy.

---

## 8. Session integrity key (`SESSION_INTEGRITY_KEY`)

Used to HMAC-stamp completed session scores (`apps/api/src/lib/integrity.ts`).
`apps/api/src/services/payout.ts` re-verifies that stamp with the **current**
key before paying out. There is no previous-key fallback, so any session
stamped with the old key and not yet paid will fail verification after
rotation.

1. Rotate between challenge payout cycles, when no completed sessions are
   waiting on payout.
2. Generate: `NEW_SIK=$(openssl rand -hex 32)` (the schema requires at least 32 characters).
3. Update the env / Docker secret.
4. Redeploy the API and payout worker together.
5. Run a test session through to payout and confirm no integrity failures.

Rollback: restore the old key and redeploy both services.

---

## 9. Phone hash salt (`PHONE_HASH_SALT`)

Phone numbers are stored only as salted hashes (see
[ADR 001](../adr/001-phone-storage.md)), so existing hashes can't be
recomputed with a new salt. Rotating it means every verified phone stops
matching and users must re-verify. That's why this secret rotates on leak
only, never on a schedule.

1. Plan a maintenance window and tell support to expect re-verification tickets.
2. Generate: `openssl rand -hex 32`.
3. Update `PHONE_HASH_SALT` and redeploy the API.
4. Monitor phone verification for failures.

Rollback: restore the old salt and redeploy. Phones verified after the
rotation will then need re-verifying.

---

## 10. SSH deploy key (`PROD_SSH_KEY`)

1. Generate a new Ed25519 keypair: `ssh-keygen -t ed25519 -C "ci-deploy-$(date +%Y%m%d)" -f /tmp/ci_deploy`
2. Add the public key to `~/.ssh/authorized_keys` on the production host.
3. Update the `PROD_SSH_KEY` GitHub secret with the new private key.
4. Remove the old public key from the prod host.
5. Trigger a test deployment to confirm connectivity.

---

## Post-rotation checklist

- [ ] Health check passes: `curl -f https://brandblitz.io/api/health`
- [ ] The affected flow works end-to-end (sign-in, OAuth, SMS, payout, deposit)
- [ ] No spike in auth, signature, or connection errors for 15 minutes
- [ ] Old secret removed from all stores (env, Docker secrets, CI)
- [ ] Rotation logged in internal tracking (what rotated, when, why)
- [ ] `.gitleaks.toml` rule updated if the old secret pattern was custom

---

## Related runbooks

- [leaked-secret.md](leaked-secret.md) for immediate containment when a secret leaks
- [rotate-s3-credentials.md](rotate-s3-credentials.md) for the detailed S3 procedure
- [rotate-minio-certs.md](rotate-minio-certs.md) for MinIO TLS cert rotation
