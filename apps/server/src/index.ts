import pino from "pino";
import { createProvider } from "@homeair/ai";
import { BaileysConnector, FakeConnector, type MessagingConnector } from "@homeair/messaging";
import { buildApp } from "./app";
import { readConfig } from "./config";
import { CopilotService } from "./copilot";
import { Db } from "./db";

const config = readConfig();
const log = pino({ level: process.env.LOG_LEVEL || "info" });

const { provider, note } = createProvider({
  provider: config.aiProvider,
  apiKey: config.aiApiKey,
  model: config.aiModel,
  effort: config.aiEffort,
  bridgeUrl: config.bridgeUrl,
  bridgeToken: config.bridgeToken,
});

const db = new Db(config.databasePath);

let connector: MessagingConnector | null = null;
if (config.connector === "baileys") {
  connector = new BaileysConnector({ sessionDir: config.whatsappSessionPath, historyPerChat: config.historyLimit, logger: log.child({ mod: "baileys" }, { level: "warn" }) });
} else if (config.connector === "fake") {
  connector = new FakeConnector();
}

const copilot = connector
  ? new CopilotService({
      connector,
      db,
      provider,
      batchMs: config.batchMs,
      recentLimit: config.recentMessageLimit,
      historyLimit: config.historyLimit,
      log: log.child({ mod: "copilot" }),
    })
  : undefined;

const app = buildApp({
  provider,
  recentMessageLimit: config.recentMessageLimit,
  staticDir: config.staticDir,
  loggerInstance: log,
  ...(copilot && connector ? { copilot, connectorName: connector.name } : {}),
});

log.info(note);
if (provider.health) {
  const health = await provider.health();
  log[health.ok ? "info" : "warn"](health.detail);
}
log.info("Copilot, not autopilot: the only send path is the manual SEND button.");

try {
  await app.listen({ port: config.port, host: config.host });
  log.info({ host: config.host, port: config.port, static: config.staticDir }, "HomeAIR listening");
} catch (error) {
  log.error(error);
  process.exit(1);
}

if (copilot && connector) {
  copilot.start();
  log.info({ connector: connector.name }, "starting messaging connector");
  connector.initialise().catch((error) => log.error({ err: (error as Error).message }, "connector failed to start"));
}

const shutdown = async () => {
  await connector?.disconnect().catch(() => undefined);
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
