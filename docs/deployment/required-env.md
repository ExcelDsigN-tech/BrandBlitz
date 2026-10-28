# Required Environment Variables

All variables listed here **must** be set before running the production stack.
There are no safe defaults — a missing value causes the compose service to fail fast.

## Docker secrets (`_FILE` convention)

Production (`docker-compose.prod.yml`) injects sensitive credentials as
**Docker secrets**, never as plain environment variables. Each affected service
receives `<VAR>_FILE=/run/secrets/<name>` (with the plain variable blanked);
the application reads the secret's contents from that path, falling back to the
plain `<VAR>` environment variable when `_FILE` is not set (as in local dev).

| Secret (`docker secret create`) | Injected into        | Env var read by app         |
| ------------------------------- | -------------------- | --------------------------- |
| `hot_wallet_secret`             | api, worker          | `HOT_WALLET_SECRET_FILE`    |
| `jwt_secret`                    | api                  | `JWT_SECRET_FILE`           |
| `webhook_secret`                | api, deposit-monitor | `WEBHOOK_SECRET_FILE`       |
| `nextauth_secret`               | web                  | `NEXTAUTH_SECRET_FILE`      |
| `google_client_secret`          | api, web             | `GOOGLE_CLIENT_SECRET_FILE` |
| `s3_secret_access_key`          | api, worker          | `S3_SECRET_ACCESS_KEY_FILE` |
| `minio_root_password`           | minio                | `MINIO_ROOT_PASSWORD_FILE`  |

Create them before running the prod stack, e.g.:

```bash
printf '%s' "$HOT_WALLET_SECRET" | docker secret create hot_wallet_secret -
```

## Application

| Variable          | Service(s)  | Description                                                       |
| ----------------- | ----------- | ----------------------------------------------------------------- |
| `NODE_ENV`        | api, worker | Must be `production`. No default — omitting it will halt compose. |
| `JWT_SECRET`      | api         | Secret used to sign JWTs. Min 32 random bytes.                    |
| `WEBHOOK_SECRET`  | api         | HMAC secret for inbound webhook validation.                       |
| `NEXTAUTH_SECRET` | web         | NextAuth.js session signing key.                                  |
| `NEXTAUTH_URL`    | api, web    | Public URL of the web app, e.g. `https://brandblitz.io`.          |
| `WEB_URL`         | api         | Same as `NEXTAUTH_URL`.                                           |

## Database

| Variable            | Service(s)            | Description                                                                                                              |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | api, worker           | PostgreSQL connection string (e.g., `postgresql://brandblitz:password@postgres:5432/brandblitz`). No default — required. |
| `REDIS_URL`         | api, worker           | Redis connection string (e.g., `redis://redis:6379/0`). No default — required.                                           |
| `POSTGRES_PASSWORD` | postgres, api, worker | Postgres password for the `brandblitz` user.                                                                             |

## CORS

| Variable          | Service(s) | Description                                                                                                                                                                                            |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ALLOWED_ORIGINS` | api        | Comma-separated list of origins permitted by CORS. No default — required. Must use explicit origins only (wildcard `*` is rejected). Example: `https://brandblitz.app,https://staging.brandblitz.app`. |

## OAuth (Google)

| Variable               | Service(s) | Description                     |
| ---------------------- | ---------- | ------------------------------- |
| `GOOGLE_CLIENT_ID`     | api, web   | Google OAuth 2.0 client ID.     |
| `GOOGLE_CLIENT_SECRET` | api, web   | Google OAuth 2.0 client secret. |

## Stellar

| Variable                | Service(s)  | Description                                      |
| ----------------------- | ----------- | ------------------------------------------------ |
| `HOT_WALLET_SECRET`     | api, worker | Stellar hot wallet secret key (starts with `S`). |
| `HOT_WALLET_PUBLIC_KEY` | api, worker | Corresponding public key (starts with `G`).      |
| `STELLAR_NETWORK`       | api, worker | `mainnet` or `testnet`.                          |

## Object Storage (S3 / MinIO)

In production, S3 credentials are injected via Docker secrets — not plain env vars.
See [rotate-s3-credentials runbook](../runbooks/rotate-s3-credentials.md).

| Variable               | Service(s)  | Description                                                                                      |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `S3_ENDPOINT`          | api, worker | S3/MinIO endpoint URL (e.g., `https://s3.brandblitz.io`). No default — required.                 |
| `S3_ACCESS_KEY_ID`     | api, worker | S3 access key ID. No default — required.                                                         |
| `S3_SECRET_ACCESS_KEY` | api, worker | S3 secret access key. No default — required.                                                     |
| `S3_PUBLIC_URL`        | api, worker | Public-facing URL for asset links (e.g., `https://assets.brandblitz.io`). No default — required. |
| `MINIO_ROOT_USER`      | minio       | MinIO root user (only for local/staging MinIO, not used in production S3).                       |

## nginx

| Variable | Service(s) | Description                                                                       |
| -------- | ---------- | --------------------------------------------------------------------------------- |
| `DOMAIN` | nginx      | Public domain, e.g. `brandblitz.io`. Required for TLS cert paths and server_name. |

## CI check

The `gitleaks.yml` workflow verifies `NODE_ENV=production` is set in the prod compose
layer and fails if the `:-development` default is re-introduced in `docker-compose.yml`.

## Validation

Run `pnpm validate-env-example` locally to verify `.env.example` stays in sync with
`apps/api/src/lib/config-schema.ts`. The `validate-env-example` CI job runs the same
script (`scripts/validate-env-example.ts`) on every PR and blocks merge when
`.env.example` is missing required vars or contains invalid values.
