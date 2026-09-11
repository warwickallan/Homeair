import { createProvider } from "@homeair/ai";
import { buildApp } from "./app";
import { readConfig } from "./config";

const config = readConfig();
const { provider, note } = createProvider({
  provider: config.aiProvider,
  apiKey: config.aiApiKey,
  model: config.aiModel,
  effort: config.aiEffort,
});

const app = buildApp({ provider, recentMessageLimit: config.recentMessageLimit });

app.log.info(note);
app.log.info("Copilot, not autopilot: this server has no ability to send messages.");

try {
  await app.listen({ port: config.port, host: "127.0.0.1" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
