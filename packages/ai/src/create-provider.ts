import { AnthropicProvider, type Effort } from "./anthropic-provider";
import { BridgeProvider, DEFAULT_BRIDGE_URL } from "./bridge-provider";
import { MockProvider } from "./mock-provider";
import type { AIProvider } from "./provider";

export type ProviderConfig = {
  provider: string;
  apiKey?: string;
  model?: string;
  effort?: string;
  bridgeUrl?: string;
  bridgeToken?: string;
};

export type ProviderSelection = {
  provider: AIProvider;
  /** Human-readable note on why this provider was chosen, for the startup log. */
  note: string;
};

const EFFORTS = new Set<Effort>(["low", "medium", "high", "xhigh", "max"]);

/**
 * Chooses a provider from config.
 *   bridge    (default) local LLM bridge — uses the machine's Claude Code login, no API key
 *   anthropic direct API — needs AI_API_KEY, falls back to mock without one
 *   mock      canned output, nothing leaves the machine
 */
export function createProvider(config: ProviderConfig): ProviderSelection {
  const wanted = (config.provider || "bridge").toLowerCase();
  const effort = config.effort && EFFORTS.has(config.effort as Effort) ? (config.effort as Effort) : undefined;

  if (wanted === "mock") {
    return { provider: new MockProvider(), note: "AI_PROVIDER=mock — canned output, nothing leaves this machine." };
  }
  if (wanted === "bridge") {
    const url = config.bridgeUrl || DEFAULT_BRIDGE_URL;
    const provider = new BridgeProvider({ url, token: config.bridgeToken, model: config.model || undefined, effort });
    return { provider, note: `LLM bridge at ${url}, model ${provider.model}${effort ? `, effort ${effort}` : ""}.` };
  }
  if (wanted === "anthropic") {
    if (!config.apiKey) {
      return {
        provider: new MockProvider(),
        note: "AI_PROVIDER=anthropic but no AI_API_KEY / ANTHROPIC_API_KEY set — using mock provider.",
      };
    }
    const provider = new AnthropicProvider({ apiKey: config.apiKey, model: config.model || undefined, effort: effort ?? "high" });
    return { provider, note: `Anthropic API provider, model ${provider.model}, effort ${effort ?? "high"}.` };
  }
  return { provider: new MockProvider(), note: `Unknown AI_PROVIDER "${config.provider}" — using mock.` };
}
