import http from "node:http";

/**
 * Indexer-lag metrics for the deposit-monitor (issue #959, ADR 002).
 *
 * Exposed in the Prometheus text exposition format so the same scraper that
 * reads the API's `GET /metrics` (prom-client, see apps/api/src/lib/metrics.ts)
 * can read this service too. Implemented without prom-client to keep the
 * service's dependency footprint unchanged.
 *
 * SLO (docs/operations/deposit-monitor-slo.md): `deposit_monitor_indexer_lag_seconds`
 * must stay at or below the configured objective (default 60 s) for 99% of
 * 5-minute windows over a rolling 28 days.
 */

export interface IndexerMetricsSnapshot {
  lagSeconds: number;
  lagLedgers: number;
  cursorLedger: number;
  networkLedger: number;
  lastCaughtUpAt: number | null;
}

export class IndexerMetrics {
  private readonly startedAt: number;
  private lastCaughtUpAt: number | null = null;
  private cursorLedger = 0;
  private networkLedger = 0;
  private pollsTotal = 0;
  private depositsDetectedTotal = 0;
  private readonly pollErrorsTotal = new Map<string, number>();

  constructor(now: number = Date.now()) {
    this.startedAt = now;
  }

  /** A poll fetched the network tip; the cursor may or may not have advanced. */
  recordPoll(cursorLedger: number, networkLedger: number, now: number = Date.now()): void {
    this.pollsTotal += 1;
    this.cursorLedger = cursorLedger;
    this.networkLedger = Math.max(this.networkLedger, networkLedger);
    if (cursorLedger >= networkLedger) {
      this.lastCaughtUpAt = now;
    }
  }

  /** A poll failed; `networkLedger` is passed when the tip was fetched before the failure. */
  recordPollError(reason: string, networkLedger?: number): void {
    this.pollsTotal += 1;
    if (networkLedger !== undefined) {
      this.networkLedger = Math.max(this.networkLedger, networkLedger);
    }
    this.pollErrorsTotal.set(reason, (this.pollErrorsTotal.get(reason) ?? 0) + 1);
  }

  recordDepositDetected(): void {
    this.depositsDetectedTotal += 1;
  }

  /**
   * Indexer lag = seconds since the cursor was last caught up to the network
   * tip. Before the first catch-up, lag is measured from process start so a
   * monitor that never succeeds still shows a growing lag rather than zero.
   */
  snapshot(now: number = Date.now()): IndexerMetricsSnapshot {
    const reference = this.lastCaughtUpAt ?? this.startedAt;
    return {
      lagSeconds: Math.max(0, (now - reference) / 1000),
      lagLedgers: Math.max(0, this.networkLedger - this.cursorLedger),
      cursorLedger: this.cursorLedger,
      networkLedger: this.networkLedger,
      lastCaughtUpAt: this.lastCaughtUpAt,
    };
  }

  render(sloSeconds: number, now: number = Date.now()): string {
    const snap = this.snapshot(now);
    const lines: string[] = [];
    const gauge = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
    };

    gauge(
      "deposit_monitor_indexer_lag_seconds",
      "Seconds since the deposit-monitor cursor was last caught up to the latest Soroban ledger.",
      Number(snap.lagSeconds.toFixed(3))
    );
    gauge(
      "deposit_monitor_indexer_lag_ledgers",
      "Ledgers between the last observed network tip and the persisted cursor.",
      snap.lagLedgers
    );
    gauge(
      "deposit_monitor_cursor_ledger",
      "Ledger sequence the deposit-monitor has fully processed.",
      snap.cursorLedger
    );
    gauge(
      "deposit_monitor_network_ledger",
      "Latest ledger sequence reported by Soroban RPC.",
      snap.networkLedger
    );
    gauge(
      "deposit_monitor_indexer_lag_slo_seconds",
      "Configured indexer-lag SLO threshold in seconds.",
      sloSeconds
    );

    lines.push(
      "# HELP deposit_monitor_polls_total Poll iterations attempted.",
      "# TYPE deposit_monitor_polls_total counter",
      `deposit_monitor_polls_total ${this.pollsTotal}`,
      "# HELP deposit_monitor_deposits_detected_total Deposit events detected.",
      "# TYPE deposit_monitor_deposits_detected_total counter",
      `deposit_monitor_deposits_detected_total ${this.depositsDetectedTotal}`,
      "# HELP deposit_monitor_poll_errors_total Poll iterations that failed, by reason.",
      "# TYPE deposit_monitor_poll_errors_total counter"
    );
    for (const [reason, count] of [...this.pollErrorsTotal.entries()].sort()) {
      lines.push(`deposit_monitor_poll_errors_total{reason="${reason}"} ${count}`);
    }

    return `${lines.join("\n")}\n`;
  }
}

/**
 * Serves `GET /metrics` (Prometheus text) and `GET /health` (200 while lag is
 * within the SLO, 503 otherwise) for liveness probes and external monitors.
 */
export function createMetricsServer(
  metrics: IndexerMetrics,
  { sloSeconds }: { sloSeconds: number }
): http.Server {
  return http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    if (path === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(metrics.render(sloSeconds));
      return;
    }

    if (path === "/health") {
      const snap = metrics.snapshot();
      const healthy = snap.lagSeconds <= sloSeconds;
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: healthy ? "ok" : "lagging",
          lagSeconds: Number(snap.lagSeconds.toFixed(3)),
          lagLedgers: snap.lagLedgers,
          cursorLedger: snap.cursorLedger,
          networkLedger: snap.networkLedger,
          sloSeconds,
        })
      );
      return;
    }

    res.writeHead(404).end();
  });
}
