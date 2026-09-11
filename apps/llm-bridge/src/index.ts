import { ClaudeCodeBackend } from "./backends/claude-code";
import { readConfig } from "./config";
import { buildBridgeApp } from "./server";

const config = readConfig();

if (config.backend !== "claude-code") {
  console.error(`Unknown BRIDGE_BACKEND "${config.backend}". Only "claude-code" exists so far.`);
  process.exit(1);
}

const backend = new ClaudeCodeBackend({ bin: config.claudeBin, defaultTimeoutMs: config.defaultTimeoutMs });
const app = buildBridgeApp({ backend, maxConcurrency: config.maxConcurrency, token: config.token });

const health = await backend.health();
app.log.info({ ok: health.ok, version: health.version, authMethod: health.authMethod }, health.detail);
if (!health.ok) app.log.warn("Bridge is starting anyway; requests will fail until Claude Code is available and logged in.");
app.log.info(config.token ? "Bearer token required on /v1/generate." : "No BRIDGE_TOKEN set; loopback-only access.");

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
