import { z } from "zod";

/**
 * The bridge's public contract. Deliberately domain-free: a caller supplies
 * its own instructions (`system`), its untrusted data (`input`) and the JSON
 * Schema it wants back. The bridge owns *how* the model is invoked — safely,
 * without tools, without touching the caller's machine — and returns the
 * structured result. Prompts live with the app that owns the domain.
 */

export const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof Effort>;

export const GenerateRequestSchema = z.object({
  /** Short label for logs and metrics, e.g. "homeair.analyse". Never content. */
  task: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "task must be a short slug"),
  /** Trusted instructions from the calling application. */
  system: z.string().min(1).max(24_000),
  /** Untrusted data. The bridge never interprets it; it is handed to the model as the user turn. */
  input: z.string().min(1).max(400_000),
  /** JSON Schema (draft 2020-12 or 7) the output must satisfy. */
  schema: z.record(z.string(), z.unknown()),
  /** Model alias or id understood by the backend (e.g. "opus", "sonnet"). Backend default if omitted. */
  model: z.string().max(64).optional(),
  effort: Effort.optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const UsageSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
  })
  .partial();

export const GenerateMetaSchema = z.object({
  backend: z.string(),
  model: z.string().optional(),
  durationMs: z.number(),
  /** Nominal list-price cost reported by the backend. Informational on a subscription. */
  costUsd: z.number().optional(),
  usage: UsageSchema.optional(),
});
export type GenerateMeta = z.infer<typeof GenerateMetaSchema>;

export const GenerateResponseSchema = z.object({
  ok: z.literal(true),
  output: z.unknown(),
  meta: GenerateMetaSchema,
});
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

export const BridgeErrorCode = z.enum([
  "bad_request",
  "unauthorised",
  "busy",
  "backend_unavailable",
  "backend_auth",
  "backend_rate_limited",
  "backend_error",
  "output_invalid",
  "timeout",
]);
export type BridgeErrorCode = z.infer<typeof BridgeErrorCode>;

export const BridgeErrorSchema = z.object({
  ok: z.literal(false),
  code: BridgeErrorCode,
  error: z.string(),
});
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  backend: z.string(),
  version: z.string().optional(),
  loggedIn: z.boolean().optional(),
  authMethod: z.string().optional(),
  detail: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** HTTP status for each error code. */
export const STATUS_FOR_CODE: Record<BridgeErrorCode, number> = {
  bad_request: 400,
  unauthorised: 401,
  busy: 429,
  backend_unavailable: 503,
  backend_auth: 502,
  backend_rate_limited: 429,
  backend_error: 502,
  output_invalid: 502,
  timeout: 504,
};
