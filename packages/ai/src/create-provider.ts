import { AnthropicProvider, type Effort } from "./anthropic-provider";
import { MockProvider } from "./mock-provider";
import type { AIProvider } from "./provider";

export type ProviderConfig = {
  provider: string;
  apiKey?: string;
  model?: string;
  effort?: string;
};

export type ProviderSelection = {
  provider: AIProvider;
  /** Human-readable note on why this provider was chosen, for the startup log. */
  note: string;
};

const EFFORTS = new Set<Effort>(["low", "medium", "high", "xhigh", "max"]);

/** Chooses a provider from config, falling back to mock when there is no usable key. */
export function createProvider(config: ProviderConfig): ProviderSelection {
  const wanted = (config.provider || "anthropic").toLowerCase();
  if (wanted === "mock") {
    return { provider: new MockProvider(), note: "AI_PROVIDER=mock — canned output, nothing leaves this machine." };
  }
  if (wanted !== "anthropic") {
    return { provider: new MockProvider(), note: `Unknown AI_PROVIDER "${config.provider}" — using mock.` };
  }
  if (!config.apiKey) {
    return {
      provider: new MockProvider(),
      note: "No AI_API_KEY / ANTHROPIC_API_KEY set — using mock provider. Add a key to .env for real analysis.",
    };
  }
  const effort = config.effort && EFFORTS.has(config.effort as Effort) ? (config.effort as Effort) : "high";
  const provider = new AnthropicProvider({ apiKey: config.apiKey, model: config.model || undefined, effort });
  return { provider, note: `Anthropic provider, model ${provider.model}, effort ${effort}.` };
}
