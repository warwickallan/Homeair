import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// While the bridge lives in this monorepo it shares the root .env. When it is
// lifted into its own repo, this becomes its own .env.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv });

export type BridgeConfig = {
  port: number;
  host: string;
  backend: string;
  token: string | undefined;
  maxConcurrency: number;
  claudeBin: string | undefined;
  defaultTimeoutMs: number;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    port: intFrom(env.BRIDGE_PORT, 4317),
    // Loopback only. Exposing this beyond the machine would let anyone spend the subscription.
    host: env.BRIDGE_HOST || "127.0.0.1",
    backend: env.BRIDGE_BACKEND || "claude-code",
    token: env.BRIDGE_TOKEN || undefined,
    maxConcurrency: intFrom(env.BRIDGE_MAX_CONCURRENCY, 2),
    claudeBin: env.CLAUDE_BIN || undefined,
    defaultTimeoutMs: intFrom(env.BRIDGE_TIMEOUT_MS, 120_000),
  };
}

function intFrom(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
