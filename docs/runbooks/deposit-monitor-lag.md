# Runbook: Deposit-Monitor Indexer Lag

## Symptom

One or more of:

- Alert: `DepositMonitorIndexerLagHigh` (lag above the 60s SLO for 5 minutes)
- Alert: `DepositMonitorDown` (Prometheus cannot scrape the deposit-monitor)
- Alert: `DepositMonitorLagErrorBudgetBurn` or `DepositMonitorPollErrors`
- deposit-monitor logs: `Indexer lag above SLO`, `Poll error`, or
  `Failed to deliver webhook`
- `GET /health` on the deposit-monitor returns `503` with `"status":"lagging"`
- Brands report that a funded challenge is stuck on "awaiting deposit"

## Impact

| Component                  | Effect                                                                        |
| -------------------------- | ----------------------------------------------------------------------------- |
| Challenge launches         | **Blocked**: deposits are not detected, so challenges are never marked funded |
| Existing active challenges | **Unaffected**: gameplay does not depend on the indexer                       |
| Payouts                    | **Unaffected** unless the root cause is a shared Stellar outage               |

The SLO and metric definitions are in
[`../operations/deposit-monitor-slo.md`](../operations/deposit-monitor-slo.md).

## Diagnosis

```bash
# 1. Is the process up, and how far behind is it?
docker compose exec deposit-monitor \
  node -e "fetch('http://localhost:9464/health').then(r => r.text()).then(console.log)"
# lagLedgers > 0 with a growing lagSeconds means the cursor is stuck.
# networkLedger not moving means RPC is unreachable.

# 2. Which failure mode? Look at the poll error reasons.
docker compose exec deposit-monitor \
  node -e "fetch('http://localhost:9464/metrics').then(r => r.text()).then(console.log)" \
  | grep deposit_monitor_poll_errors_total

# 3. Read the logs.
docker compose logs deposit-monitor --tail=200 \
  | grep -Ei "poll error|webhook|lag|critical"

# 4. Check the persisted cursor.
redis-cli GET stellar:deposit_monitor:last_ledger

# 5. Is Soroban RPC healthy? (testnet shown; use the STELLAR_RPC_URL in use)
curl -s -X POST https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'

# 6. Is the API accepting the deposit webhook?
docker compose logs api --tail=200 | grep -i "webhooks/stellar/deposit"
```

Interpretation:

- `reason="rpc_error"` rising: Soroban RPC or Horizon is degraded. See
  [horizon-outage.md](horizon-outage.md).
- `reason="webhook_failure"` rising: the API is rejecting or not answering
  `POST /webhooks/stellar/deposit`. Common causes are an API outage, a
  `WEBHOOK_SECRET` mismatch after rotation, or a payload the API 4xxs on.
- No errors but lag still growing, or `DepositMonitorDown`: the process is
  wedged, crash-looping, or cannot reach Redis.

## Mitigation

1. **Process down or wedged**: restart it. The cursor is persisted in Redis,
   so a restart resumes where it left off and does not skip deposits.

   ```bash
   docker compose restart deposit-monitor
   ```

2. **RPC degraded**: follow [horizon-outage.md](horizon-outage.md). If a
   healthy alternative RPC endpoint is available, point `STELLAR_RPC_URL` at it
   and restart the service.
3. **Webhook failures**: fix the API side first. Confirm `WEBHOOK_SECRET`
   matches between `api` and `deposit-monitor` (see
   [rotate-secrets.md](rotate-secrets.md)). The monitor holds its cursor back
   while delivery fails, so no deposits are lost. They are re-delivered once
   the API accepts them.
4. Post a status update in the internal incident channel. Challenge launches
   are blocked until lag recovers.

## Remediation

1. Confirm `deposit_monitor_indexer_lag_seconds` drops back under the
   objective and `GET /health` returns `200`.
2. Confirm the backlog drained: `deposit_monitor_indexer_lag_ledgers` is `0`
   and `deposit_monitor_deposits_detected_total` increased for the deposits
   that arrived during the incident.
3. Spot-check that stuck challenges moved out of the awaiting-deposit state.
   If one did not, replay its deposit with
   `scripts/simulate-deposit-webhook.ts` against the matching memo (see
   `apps/deposit-monitor/README.md`).
4. Never reset `stellar:deposit_monitor:last_ledger` to `0` or delete it. On
   the next poll the monitor would jump to the current tip and silently skip
   every deposit in between.

## Post-mortem

File a post-mortem if challenge launches were blocked for more than 30
minutes or the incident consumed more than half of the monthly error budget.
Link template: [post-mortem template](https://www.notion.so/brandblitz/post-mortem-template)
