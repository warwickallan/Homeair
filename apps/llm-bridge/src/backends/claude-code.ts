import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { tmpdir } from "node:os";
import { BackendError, type Backend, type BackendHealth, type GenerateResult } from "../backend";
import type { GenerateRequest } from "../contract";

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type ClaudeCodeBackendOptions = {
  /** Path to the claude binary. Default: "claude" resolved from PATH. */
  bin?: string;
  /** Working directory for the child. Somewhere with no CLAUDE.md. Default: OS temp dir. */
  cwd?: string;
  defaultTimeoutMs?: number;
  /** Injection point for tests. */
  spawnFn?: SpawnFn;
};

/**
 * Runs `claude -p` in the most locked-down configuration the CLI offers:
 *
 *   --tools ""               no built-in tools at all (no shell, no files, no web)
 *   --strict-mcp-config      no MCP servers from the user's config
 *   --safe-mode              no hooks, CLAUDE.md, plugins, skills, custom agents
 *   --no-session-persistence nothing written to the transcript store
 *   --permission-prompts none anything that would prompt is denied
 *   --system-prompt          replaces Claude Code's coding persona with the caller's
 *   --json-schema            structured output, enforced by the CLI
 *
 * Authentication is whatever the user's Claude Code login is. The bridge
 * never sees credentials.
 *
 * Content hygiene: the caller's `input` goes to the child over stdin, never
 * on the command line (argv is visible to other local processes). Nothing
 * from stdin/stdout is logged here.
 */
export class ClaudeCodeBackend implements Backend {
  readonly name = "claude-code";
  private readonly bin: string;
  private readonly cwd: string;
  private readonly defaultTimeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private healthCache: { at: number; value: BackendHealth } | null = null;

  constructor(opts: ClaudeCodeBackendOptions = {}) {
    this.bin = opts.bin ?? "claude";
    this.cwd = opts.cwd ?? tmpdir();
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;
    this.spawnFn = opts.spawnFn ?? (nodeSpawn as SpawnFn);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(normaliseSchema(req.schema)),
      "--tools",
      "",
      "--strict-mcp-config",
      "--safe-mode",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--permission-prompts",
      "none",
      "--system-prompt",
      req.system,
    ];
    if (req.model) args.push("--model", req.model);
    if (req.effort) args.push("--effort", req.effort);

    const started = Date.now();
    const run = await this.run(args, req.input, req.timeoutMs ?? this.defaultTimeoutMs);
    const durationMs = Date.now() - started;

    if (run.timedOut) {
      throw new BackendError("timeout", `Claude Code did not respond within ${req.timeoutMs ?? this.defaultTimeoutMs}ms.`);
    }

    const envelope = parseEnvelope(run.stdout);
    if (!envelope) {
      if (run.code !== 0) throw classifyFailure(run.stderr, "", null);
      throw new BackendError("output_invalid", "Claude Code returned something that was not a JSON result envelope.");
    }
    if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success")) {
      throw classifyFailure(run.stderr, envelope.result ?? "", envelope.api_error_status ?? null, envelope.subtype);
    }

    const output = envelope.structured_output ?? tryParseJson(envelope.result);
    if (output === undefined) {
      throw new BackendError("output_invalid", "Claude Code completed but produced no structured output.");
    }

    return { output, meta: { backend: this.name, durationMs, ...metaFrom(envelope) } };
  }

  async health(): Promise<BackendHealth> {
    const now = Date.now();
    if (this.healthCache && now - this.healthCache.at < 30_000) return this.healthCache.value;

    let value: BackendHealth;
    const version = await this.run(["--version"], "", 15_000);
    if (version.timedOut || version.code !== 0) {
      const why = version.timedOut ? "timed out" : version.stderr.trim().split("\n")[0] || `exit ${version.code}`;
      value = { ok: false, detail: `Claude Code CLI not available (${why}).` };
    } else {
      const versionText = version.stdout.trim().split("\n")[0] ?? "";
      const status = await this.run(["auth", "status", "--json"], "", 15_000);
      const parsed = tryParseJson(status.stdout) as { loggedIn?: boolean; authMethod?: string } | undefined;
      const loggedIn = parsed?.loggedIn === true;
      value = {
        ok: loggedIn,
        version: versionText,
        loggedIn,
        authMethod: parsed?.authMethod,
        detail: loggedIn
          ? `Claude Code ${versionText}, logged in via ${parsed?.authMethod ?? "unknown"}.`
          : `Claude Code ${versionText} is installed but not logged in. Run: claude auth login`,
      };
    }
    this.healthCache = { at: now, value };
    return value;
  }

  private run(args: string[], stdin: string, timeoutMs: number): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnFn(this.bin, args, {
          cwd: this.cwd,
          env: childEnv(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        reject(spawnFailure(error));
        return;
      }

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => (stdout += chunk));
      child.stderr?.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(spawnFailure(error));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });

      if (child.stdin) {
        child.stdin.on("error", () => undefined); // EPIPE if the child exits early; 'close' reports it
        child.stdin.end(stdin);
      }
    });
  }
}

type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** The parts of Claude Code's `--output-format json` envelope this backend reads. */
type Envelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  api_error_status?: number | null;
  total_cost_usd?: number;
  modelUsage?: Record<
    string,
    {
      canonicalModel?: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  >;
};

/**
 * Claude Code's --json-schema validator rejects a `$schema` declaration
 * (it has no draft meta-schemas registered), and Zod 4's toJSONSchema emits
 * one by default. Drop it; the rest of the schema is understood as-is.
 */
export function normaliseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dropped, ...rest } = schema;
  return rest;
}

function parseEnvelope(stdout: string): Envelope | null {
  const parsed = tryParseJson(stdout.trim());
  if (parsed && typeof parsed === "object" && (parsed as Envelope).type === "result") return parsed as Envelope;
  // Some builds print progress lines before the envelope; take the last JSON line that is a result.
  for (const line of stdout.trim().split("\n").reverse()) {
    const candidate = tryParseJson(line.trim());
    if (candidate && typeof candidate === "object" && (candidate as Envelope).type === "result") return candidate as Envelope;
  }
  return null;
}

function tryParseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Claude Code may use a small model for side tasks alongside the main one, so
 * `modelUsage` can hold several entries. The main generation is the one that
 * produced the most output tokens; cost is the total across all of them.
 */
function metaFrom(envelope: Envelope): { model?: string; costUsd?: number; usage?: GenerateResult["meta"]["usage"] } {
  const entries = Object.entries(envelope.modelUsage ?? {});
  const main = entries.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))[0];
  if (!main) return { costUsd: envelope.total_cost_usd };
  const [key, u] = main;
  return {
    model: u.canonicalModel ?? key,
    costUsd: envelope.total_cost_usd,
    usage: {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadInputTokens,
      cacheCreationTokens: u.cacheCreationInputTokens,
    },
  };
}

function spawnFailure(error: unknown): BackendError {
  const code = (error as { code?: string }).code;
  if (code === "ENOENT") {
    return new BackendError("backend_unavailable", "Claude Code CLI not found. Install it or set CLAUDE_BIN to the binary path.", {
      cause: error,
    });
  }
  return new BackendError("backend_unavailable", `Could not start Claude Code: ${(error as Error).message ?? String(error)}`, {
    cause: error,
  });
}

/** Maps a failed run to a bridge error code from the API status and the error text. */
export function classifyFailure(stderr: string, resultText: string, apiStatus: number | null, subtype?: string): BackendError {
  const text = `${stderr}\n${resultText}`;
  const firstLine = (resultText.trim() || stderr.trim()).split("\n")[0]?.slice(0, 300) || subtype || "unknown error";

  if (apiStatus === 401 || apiStatus === 403 || /not logged in|please (log|sign) in|run .*auth login|authentication|unauthori[sz]ed|token .*expired|invalid api key/i.test(text)) {
    return new BackendError("backend_auth", `Claude Code is not authenticated: ${firstLine}`);
  }
  if (apiStatus === 429 || /rate limit|usage limit|too many requests|overloaded|\b429\b|\b529\b/i.test(text)) {
    return new BackendError("backend_rate_limited", `Claude Code is rate limited: ${firstLine}`);
  }
  return new BackendError("backend_error", `Claude Code failed${apiStatus ? ` (API ${apiStatus})` : ""}: ${firstLine}`);
}

/**
 * Child environment. Removes the markers Claude Code sets in its own
 * terminals so the bridge works when launched from inside a Claude Code
 * session (otherwise the CLI refuses to nest).
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}
