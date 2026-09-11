import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { BackendError, type Backend } from "./backend";
import {
  GenerateRequestSchema,
  STATUS_FOR_CODE,
  type BridgeError,
  type GenerateResponse,
  type HealthResponse,
} from "./contract";

export type BridgeAppOptions = {
  backend: Backend;
  /** Max concurrent backend invocations. Each is a separate model process. */
  maxConcurrency?: number;
  /** Requests waiting beyond this are refused with `busy` rather than queued forever. */
  maxQueue?: number;
  /** If set, callers must send `Authorization: Bearer <token>`. */
  token?: string;
  logger?: boolean;
};

/**
 * Privacy: this server never logs `system`, `input` or `output`. Log lines
 * carry the task label, duration, backend model and error codes only.
 */
export function buildBridgeApp(opts: BridgeAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 4 * 1024 * 1024 });
  const { backend } = opts;
  const gate = new Semaphore(opts.maxConcurrency ?? 2, opts.maxQueue ?? 10);

  app.get("/v1/health", async (): Promise<HealthResponse> => {
    const health = await backend.health();
    return { backend: backend.name, ...health };
  });

  app.post("/v1/generate", async (request, reply): Promise<GenerateResponse | BridgeError> => {
    if (opts.token && !authorised(request, opts.token)) {
      return reply.code(STATUS_FOR_CODE.unauthorised).send(<BridgeError>{ ok: false, code: "unauthorised", error: "Missing or invalid bearer token." });
    }
    const parsed = GenerateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.length ? ` at ${first.path.join(".")}` : "";
      return reply.code(400).send(<BridgeError>{ ok: false, code: "bad_request", error: `Invalid request${where}: ${first?.message ?? "unknown"}` });
    }
    const req = parsed.data;

    const release = await gate.acquire();
    const started = Date.now();
    try {
      const result = await backend.generate(req);
      request.log.info(
        { task: req.task, backend: backend.name, model: result.meta.model, durationMs: Date.now() - started, costUsd: result.meta.costUsd },
        "generate ok",
      );
      return { ok: true, output: result.output, meta: result.meta };
    } finally {
      release();
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof BackendError) {
      request.log.warn({ code: error.code }, "backend error");
      return reply.code(STATUS_FOR_CODE[error.code]).send(<BridgeError>{ ok: false, code: error.code, error: error.message });
    }
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      return reply.code(statusCode).send(<BridgeError>{ ok: false, code: "bad_request", error: err.message });
    }
    request.log.error({ err: err.message }, "unhandled error");
    return reply.code(500).send(<BridgeError>{ ok: false, code: "backend_error", error: "Internal bridge error" });
  });

  return app;
}

function authorised(request: FastifyRequest, token: string): boolean {
  const header = request.headers.authorization ?? "";
  return header === `Bearer ${token}`;
}

/** Tiny counting semaphore with a bounded wait queue. */
class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  acquire(): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.max) {
        grant();
      } else if (this.waiting.length >= this.maxQueue) {
        reject(new BackendError("busy", "Bridge is busy; try again shortly."));
      } else {
        this.waiting.push(grant);
      }
    });
  }
}
