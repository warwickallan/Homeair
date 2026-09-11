import type { BridgeErrorCode, GenerateMeta, GenerateRequest } from "./contract";

/**
 * A backend is anything that can turn (system, input, schema) into a JSON
 * object. Claude Code is the first; an API model, Ollama or Codex would be
 * additional files implementing this, nothing else changes.
 */
export interface Backend {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  health(): Promise<BackendHealth>;
}

export type GenerateResult = {
  output: unknown;
  meta: GenerateMeta;
};

export type BackendHealth = {
  ok: boolean;
  version?: string;
  loggedIn?: boolean;
  authMethod?: string;
  detail: string;
};

export class BackendError extends Error {
  constructor(
    public readonly code: BridgeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BackendError";
  }
}
