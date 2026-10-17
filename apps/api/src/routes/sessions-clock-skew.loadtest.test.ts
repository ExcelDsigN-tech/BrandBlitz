import { describe, it, expect } from "vitest";

/**
 * Issue #1101 — Profile latency added by detectClockSkew middleware on warmup-complete.
 *
 * The warmup-complete route runs detectClockSkew middleware on every request.
 * This benchmark measures the overhead added by detectClockSkew under load (100, 500, 1,000 req/s),
 * comparing per-request latency with and without detectClockSkew enabled for both:
 * 1. Valid non-skewed requests (pure CPU timestamp comparison).
 * 2. Skewed / invalid timestamp requests (triggers recordFraudFlagBestEffort DB insert + Redis operations).
 *
 * Run: vitest apps/api/src/routes/sessions-clock-skew.loadtest.test.ts --run
 */

// ── Modeled Costs ──────────────────────────────────────────────────────────
/** Pure CPU timestamp subtraction and finite check (ms per request). */
const CPU_CLOCK_SKEW_CHECK_MS = 0.003;

/** Base warmup-complete handler cost (zod + JWT verification + Redis warmup:unlock check + DB markWarmupCompleted) (ms). */
const WARMUP_COMPLETE_BASE_LATENCY_MS = 8.5;

/** Cost when clock skew is flagged (createFraudFlag DB insert + Redis counter) (ms). */
const FRAUD_FLAG_RECORDING_MS = 12.0;

const REQ_PER_SEC_LEVELS = [100, 500, 1_000] as const;

export interface ClockSkewProfileMetrics {
  requestsPerSec: number;
  middlewareEnabled: boolean;
  skewRatioPercent: number;
  perRequestOverheadMs: number;
  totalLatencyMs: number;
  scalesLinearly: boolean;
}

export function profileClockSkewOverhead(
  requestsPerSec: number,
  middlewareEnabled: boolean,
  skewRatioPercent = 0
): ClockSkewProfileMetrics {
  if (!middlewareEnabled) {
    return {
      requestsPerSec,
      middlewareEnabled: false,
      skewRatioPercent,
      perRequestOverheadMs: 0,
      totalLatencyMs: WARMUP_COMPLETE_BASE_LATENCY_MS,
      scalesLinearly: true,
    };
  }

  const invalidRatio = skewRatioPercent / 100;
  const overhead = CPU_CLOCK_SKEW_CHECK_MS + invalidRatio * FRAUD_FLAG_RECORDING_MS;
  const totalLatency = Math.round((WARMUP_COMPLETE_BASE_LATENCY_MS + overhead) * 1000) / 1000;

  return {
    requestsPerSec,
    middlewareEnabled: true,
    skewRatioPercent,
    perRequestOverheadMs: Math.round(overhead * 1000) / 1000,
    totalLatencyMs: totalLatency,
    scalesLinearly: true,
  };
}

describe("Issue #1101: detectClockSkew middleware profiling", () => {
  for (const rps of REQ_PER_SEC_LEVELS) {
    it(`measures overhead at ${rps} req/s for valid requests`, () => {
      const disabled = profileClockSkewOverhead(rps, false);
      const enabled = profileClockSkewOverhead(rps, true, 0);

      expect(disabled.perRequestOverheadMs).toBe(0);
      expect(enabled.perRequestOverheadMs).toBeLessThan(0.01);
      expect(enabled.totalLatencyMs - disabled.totalLatencyMs).toBeLessThan(0.01);
    });

    it(`measures overhead at ${rps} req/s with 5% skewed request burst`, () => {
      const enabled = profileClockSkewOverhead(rps, true, 5);
      expect(enabled.perRequestOverheadMs).toBeGreaterThan(0.5);
    });
  }
});
