# ADR 005: Sentry for Application Errors, OpenTelemetry for Traces / Metrics (#115)

## Status

Accepted. **Partially implemented**: the Sentry half ships today. The
OpenTelemetry half is decided but **not yet built** (see
[Implementation status](#implementation-status)).

## Context

BrandBlitz needs production observability across three distinct
lenses:

1. **Application errors** — uncaught exceptions, request-level
   failures, with source-mapped stack traces and a UI good enough
   for non-SRE engineers to debug a 3am page.
2. **Distributed traces** — per-request causality across the API,
   the deposit-monitor, the BullMQ queues, and Soroban RPC calls.
3. **Metrics** — request rates, queue depths, p95 latencies.

Picking one vendor for all three was tempting (Datadog, New Relic,
Sentry's "everything" tier). Each comes with a cost-and-flexibility
trade-off that we explicitly evaluated.

## Decision

We split the stack along the lens boundary:

- **Errors → Sentry**. The frontend and backend both report
  unhandled exceptions and explicitly-captured errors to Sentry.
  Source maps are uploaded on every CI build (see `ci.yml`).
- **Traces + metrics → OpenTelemetry** (_planned, not yet
  implemented_). The API **will** initialise the OpenTelemetry SDK
  with the OTLP/HTTP exporter. The destination **will** be configurable
  via `OTEL_EXPORTER_OTLP_ENDPOINT`, so the same code ships to Jaeger
  (local dev), Tempo (staging), or Grafana Cloud (prod) without
  recompilation. Today no `@opentelemetry/*` package is a dependency of
  any workspace, nothing reads `OTEL_EXPORTER_OTLP_ENDPOINT`, and no
  trace exporter runs. Metrics that exist today are Prometheus metrics
  exposed via `prom-client` on the API's `GET /metrics`
  (`apps/api/src/lib/metrics.ts`) and the deposit-monitor's
  `GET /metrics` (`apps/deposit-monitor/src/metrics.ts`).

No vendor SDK calls in application code outside the two thin
adapters in `apps/api/src/lib/sentry.ts` and the future tracing
bootstrap.

## Rationale

- **Right tool for the lens**: Sentry's UI is the best-in-class
  error-investigation surface; nothing OTel-native matches it for
  triage. Conversely, OpenTelemetry's trace API is the de facto
  industry standard and lets us swap backends without rewriting
  instrumentation.
- **Vendor-lock asymmetry**: Sentry's data shape is proprietary, but
  errors are intrinsically vendor-specific (source maps, fingerprints).
  Traces and metrics are commodity data; switching trace vendors
  shouldn't force a code rewrite.
- **Cost shape**: error volume is bounded by code quality; trace
  volume is bounded by request volume. Splitting the lenses gives us
  separate cost controls instead of bundling them.
- **Operational simplicity in dev**: OTel-with-Jaeger is a single
  `docker compose up` away. Sentry has a free dev tier. No vendor
  asks for an SDK in our hot path.

Considered alternatives:

- **All-in-Sentry** (errors + tracing + performance): viable, but
  ties tracing to a vendor and pays the proprietary-shape cost on
  both lenses.
- **All-in-Datadog / New Relic**: powerful, but the cost curve
  bites harder than the split. Also pulls a vendor SDK into the hot
  path.
- **All-in-OpenTelemetry** (errors as span events): possible, but
  error triage UX is materially worse than Sentry, and the
  source-map upload story doesn't exist in the OTel ecosystem yet.

## Consequences

- Two observability vendors to manage — secrets, dashboards, and
  alert routes need to live in both places.
- Source maps must continue to upload to Sentry on every build
  (already wired in `ci.yml`).
- **TODO (not implemented):** the OpenTelemetry bootstrap
  (`apps/api/src/lib/tracing.ts`) does not exist yet. When it is
  built it must follow this ADR's contract: OTLP exporter only, no
  vendor SDKs.
- Cross-lens debugging requires correlating a Sentry event with a
  trace ID. **Planned, not implemented:** once the tracing bootstrap
  exists, `traceparent` will be propagated on every response so a
  Sentry event in the frontend can link back to its server-side
  trace. Today no `traceparent` header is emitted.

## Implementation status

| Half                      | Status              | Evidence                                                                            |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| Errors → Sentry           | **Shipped**         | `apps/api/src/lib/sentry.ts`; source-map upload steps in `.github/workflows/ci.yml` |
| Traces → OpenTelemetry    | **Not implemented** | No `@opentelemetry/*` dependency; no `apps/api/src/lib/tracing.ts`                  |
| `traceparent` propagation | **Not implemented** | Depends on the tracing bootstrap                                                    |

Acceptance check for the OpenTelemetry half:

```bash
grep -rl '@opentelemetry' --include=package.json apps packages
```

This returns nothing today. Until it returns the workspace(s) that
initialise the SDK _and_ `apps/api/src/lib/tracing.ts` exists, this ADR
must not describe OpenTelemetry as initialised. Building the bootstrap
is tracked separately from the docs correction (issue #961). Link the
implementation issue here once it is filed.

## References

- `apps/api/src/lib/sentry.ts`
- `ci.yml` source-map upload steps
- `apps/api/src/lib/tracing.ts`: planned path, does not exist yet
- Issue #961: marks the OpenTelemetry half as not yet implemented
- Closes #115.
