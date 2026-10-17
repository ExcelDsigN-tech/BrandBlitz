# Deposit-Monitor SLO

ADR 002 ([`../adr/002-escrow-usage.md`](../adr/002-escrow-usage.md)) makes
`apps/deposit-monitor/` load-bearing: a stalled indexer blocks every challenge
launch. This page defines the SLO the service is held to, the signal it is
measured with, and the alerts that fire when it is violated (issue #959).

## SLI: indexer lag

`deposit_monitor_indexer_lag_seconds` (gauge) is the number of seconds since
the deposit-monitor's persisted cursor (`stellar:deposit_monitor:last_ledger`
in Redis) was last caught up to the latest ledger reported by Soroban RPC.

- A healthy poll that processes every event up to the network tip resets it to
  `0`. With the default `DEPOSIT_POLL_INTERVAL_MS=5000`, it oscillates between
  0 and about 5 seconds.
- It keeps growing while polls fail (`rpc_error`), while a webhook delivery to
  the API fails (`webhook_failure`, the cursor is deliberately held back), or
  while the process is wedged.
- Before the first successful poll, it is measured from process start, so a
  monitor that never succeeds is never reported as healthy.

The service exposes it on `GET /metrics` (Prometheus text format) and
summarises it on `GET /health`, both on `METRICS_PORT` (default `9464`). It
also logs `Indexer lag above SLO` at `warn` level on every poll while the lag
exceeds the objective, for log-based alerting.

| Metric                                      | Type    | Meaning                                          |
| ------------------------------------------- | ------- | ------------------------------------------------ |
| `deposit_monitor_indexer_lag_seconds`       | gauge   | The SLI (see above)                              |
| `deposit_monitor_indexer_lag_ledgers`       | gauge   | Last observed network tip minus the cursor       |
| `deposit_monitor_cursor_ledger`             | gauge   | Ledger the monitor has fully processed           |
| `deposit_monitor_network_ledger`            | gauge   | Latest ledger reported by Soroban RPC            |
| `deposit_monitor_indexer_lag_slo_seconds`   | gauge   | Configured objective (`INDEXER_LAG_SLO_SECONDS`) |
| `deposit_monitor_polls_total`               | counter | Poll iterations attempted                        |
| `deposit_monitor_poll_errors_total{reason}` | counter | Failed polls, by `rpc_error` / `webhook_failure` |
| `deposit_monitor_deposits_detected_total`   | counter | Deposit events detected                          |

## SLO

> **Indexer lag behind the latest Soroban ledger must stay at or below 60
> seconds for 99% of 5-minute windows, measured over a rolling 28 days.**

- A 5-minute window is _bad_ if any sample in it exceeds the objective
  (`deposit_monitor:lag_window_bad:5m` recording rule).
- Error budget: 1% of windows, which is about 6.7 hours of bad windows per 28
  days.
- 60 seconds is about 12 polls at the default interval, or about 10 Stellar
  ledgers. That is enough headroom to ride out a transient RPC error or one
  failed webhook retry without paging. It is still well under the time a
  brand will wait on the "awaiting deposit" screen before contacting support.
- The objective is configurable per deployment via `INDEXER_LAG_SLO_SECONDS`.
  The alert rules read it from the exported
  `deposit_monitor_indexer_lag_slo_seconds` gauge, so changing it does not
  require editing the rules.

## Alerts

Defined in
[`infra/prometheus/alerts/deposit-monitor.rules.yml`](../../infra/prometheus/alerts/deposit-monitor.rules.yml)
and unit-tested by `deposit-monitor.rules.test.yml` next to it. Prometheus is
the observability stack the repo already uses (`prom-client` on the API's
`GET /metrics`). ADR 005's OpenTelemetry half is not implemented yet.

| Alert                              | Severity | Fires when                                                          |
| ---------------------------------- | -------- | ------------------------------------------------------------------- |
| `DepositMonitorIndexerLagHigh`     | page     | Lag above the objective for 5 minutes                               |
| `DepositMonitorDown`               | page     | `up{job="deposit-monitor"} == 0` for 2 minutes                      |
| `DepositMonitorLagErrorBudgetBurn` | ticket   | More than 6% of windows bad over both 6h and 1h (6x budget burn)    |
| `DepositMonitorPollErrors`         | ticket   | More than 5 poll errors of one reason in 10 minutes, for 10 minutes |

All alerts link to the runbook
[`../runbooks/deposit-monitor-lag.md`](../runbooks/deposit-monitor-lag.md).

### Wiring it up

1. Make the deposit-monitor reachable by Prometheus on `METRICS_PORT`. Inside
   the Compose network that is `deposit-monitor:9464`.
2. Add a scrape job named `deposit-monitor`:

   ```yaml
   scrape_configs:
     - job_name: deposit-monitor
       scrape_interval: 15s
       static_configs:
         - targets: ["deposit-monitor:9464"]
   ```

3. Load the rules file via `rule_files:` and route `severity="page"` to the
   on-call pager and `severity="ticket"` to the team queue in Alertmanager.

Validate rule changes before merging:

```bash
promtool check rules infra/prometheus/alerts/deposit-monitor.rules.yml
promtool test rules infra/prometheus/alerts/deposit-monitor.rules.test.yml
```
