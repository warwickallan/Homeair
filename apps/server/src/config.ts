import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// .env lives at the repo root regardless of which directory the server is launched from.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const rootEnv = resolve(root, ".env");
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv });

export type ServerConfig = {
  port: number;
  /** 127.0.0.1 for this machine only; 0.0.0.0 to reach it from the phone over Tailscale. */
  host: string;
  aiProvider: string;
  aiApiKey: string | undefined;
  aiModel: string | undefined;
  aiEffort: string | undefined;
  bridgeUrl: string | undefined;
  bridgeToken: string | undefined;
  recentMessageLimit: number;
  connector: "baileys" | "fake" | "none";
  whatsappSessionPath: string;
  databasePath: string;
  batchMs: number;
  historyLimit: number;
  staticDir: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const connector = (env.WHATSAPP_CONNECTOR || "baileys").toLowerCase();
  return {
    port: intFrom(env.PORT, 3000),
    host: env.HOST || "127.0.0.1",
    aiProvider: env.AI_PROVIDER ?? "bridge",
    aiApiKey: env.AI_API_KEY || env.ANTHROPIC_API_KEY || undefined,
    aiModel: env.AI_MODEL || undefined,
    aiEffort: env.AI_EFFORT || undefined,
    bridgeUrl: env.BRIDGE_URL || (env.BRIDGE_PORT ? `http://127.0.0.1:${env.BRIDGE_PORT}` : undefined),
    bridgeToken: env.BRIDGE_TOKEN || undefined,
    recentMessageLimit: intFrom(env.RECENT_MESSAGE_LIMIT, 30),
    connector: connector === "fake" ? "fake" : connector === "none" ? "none" : "baileys",
    whatsappSessionPath: resolve(root, env.WHATSAPP_SESSION_PATH || "./data/whatsapp-session"),
    databasePath: resolve(root, env.DATABASE_PATH || "./data/homeair.db"),
    batchMs: Math.round(Number.parseFloat(env.MESSAGE_BATCH_SECONDS || "5") * 1000) || 5000,
    historyLimit: intFrom(env.HISTORY_LIMIT, 50),
    staticDir: resolve(root, "apps/web/dist"),
  };
}

function intFrom(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
