import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { IndexerMetrics, createMetricsServer } from "./metrics";

describe("IndexerMetrics", () => {
  it("reports lag since process start before the first catch-up", () => {
    const metrics = new IndexerMetrics(1_000);
    expect(metrics.snapshot(31_000).lagSeconds).toBe(30);
  });

  it("resets lag when the cursor catches up to the network tip", () => {
    const metrics = new IndexerMetrics(0);
    metrics.recordPoll(500, 500, 100_000);
    const snap = metrics.snapshot(105_000);
    expect(snap.lagSeconds).toBe(5);
    expect(snap.lagLedgers).toBe(0);
  });

  it("keeps growing lag while the cursor is stuck behind the tip", () => {
    const metrics = new IndexerMetrics(0);
    metrics.recordPoll(500, 500, 10_000);
    metrics.recordPollError("webhook_failure", 520);
    metrics.recordPollError("rpc_error");
    const snap = metrics.snapshot(130_000);
    expect(snap.lagSeconds).toBe(120);
    expect(snap.lagLedgers).toBe(20);
  });

  it("renders Prometheus text exposition", () => {
    const metrics = new IndexerMetrics(0);
    metrics.recordPoll(10, 12, 1_000);
    metrics.recordDepositDetected();
    metrics.recordPollError("rpc_error");
    const text = metrics.render(60, 3_000);
    expect(text).toContain("# TYPE deposit_monitor_indexer_lag_seconds gauge");
    expect(text).toContain("deposit_monitor_indexer_lag_seconds 3");
    expect(text).toContain("deposit_monitor_indexer_lag_ledgers 2");
    expect(text).toContain("deposit_monitor_indexer_lag_slo_seconds 60");
    expect(text).toContain("deposit_monitor_polls_total 2");
    expect(text).toContain("deposit_monitor_deposits_detected_total 1");
    expect(text).toContain('deposit_monitor_poll_errors_total{reason="rpc_error"} 1');
  });
});

describe("createMetricsServer", () => {
  let server: ReturnType<typeof createMetricsServer> | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  async function start(metrics: IndexerMetrics, sloSeconds: number): Promise<string> {
    server = createMetricsServer(metrics, { sloSeconds });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("serves /metrics and a healthy /health while within the SLO", async () => {
    const metrics = new IndexerMetrics();
    metrics.recordPoll(100, 100);
    const base = await start(metrics, 60);

    const metricsRes = await fetch(`${base}/metrics`);
    expect(metricsRes.status).toBe(200);
    expect(await metricsRes.text()).toContain("deposit_monitor_indexer_lag_seconds");

    const healthRes = await fetch(`${base}/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({ status: "ok", cursorLedger: 100 });
  });

  it("returns 503 from /health when lag exceeds the SLO", async () => {
    const metrics = new IndexerMetrics(Date.now() - 120_000);
    const base = await start(metrics, 60);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "lagging" });
  });

  it("returns 404 for unknown paths", async () => {
    const base = await start(new IndexerMetrics(), 60);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
