import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  REDIS_URL: z.string().url(),
  STELLAR_NETWORK: z.enum(["testnet", "public"]).default("testnet"),
  STELLAR_RPC_URL: z.string().url().optional(),
  HOT_WALLET_PUBLIC_KEY: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  API_URL: z.string().url(),
  DEPOSIT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // Port for GET /metrics (Prometheus) and GET /health. 0 disables the server.
  METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  // Indexer-lag SLO threshold (docs/operations/deposit-monitor-slo.md).
  INDEXER_LAG_SLO_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "verbose", "debug", "silly"]).default("info"),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Readonly<Config> {
  try {
    const parsed = configSchema.parse(process.env);

    // Log non-secret config values at startup
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      redacted[k] = k === "WEBHOOK_SECRET" ? "[redacted]" : v;
    }
    console.info("✅ Config loaded", redacted);

    return Object.freeze(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return `  • ${path}: ${issue.message}`;
        })
        .join("\n");
      console.error(
        `❌ Invalid or missing environment variables:\n${details}\n` +
          `Check your .env file for the expected format.`
      );
      process.exit(1);
    }
    throw error;
  }
}

export const config: Readonly<Config> = loadConfig();
