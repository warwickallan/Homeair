import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// .env lives at the repo root regardless of which directory the server is launched from.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv });

export type ServerConfig = {
  port: number;
  aiProvider: string;
  aiApiKey: string | undefined;
  aiModel: string | undefined;
  aiEffort: string | undefined;
  bridgeUrl: string | undefined;
  bridgeToken: string | undefined;
  recentMessageLimit: number;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: intFrom(env.PORT, 3000),
    aiProvider: env.AI_PROVIDER ?? "bridge",
    aiApiKey: env.AI_API_KEY || env.ANTHROPIC_API_KEY || undefined,
    aiModel: env.AI_MODEL || undefined,
    aiEffort: env.AI_EFFORT || undefined,
    bridgeUrl: env.BRIDGE_URL || (env.BRIDGE_PORT ? `http://127.0.0.1:${env.BRIDGE_PORT}` : undefined),
    bridgeToken: env.BRIDGE_TOKEN || undefined,
    recentMessageLimit: intFrom(env.RECENT_MESSAGE_LIMIT, 30),
  };
}

function intFrom(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
