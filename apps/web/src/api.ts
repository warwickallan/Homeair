import type {
  AnalyseRequest,
  AnalyseResponse,
  ApiError,
  AskRequest,
  AskResponse,
  HealthResponse,
  SuggestRequest,
  SuggestResponse,
} from "@homeair/shared";

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let err: ApiError = { error: `Request failed (${res.status})`, code: "http_error" };
    try {
      err = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(err.code, err.error, res.status);
  }
  return (await res.json()) as TRes;
}

export const api = {
  health: async (): Promise<HealthResponse> => {
    const res = await fetch("/api/health");
    if (!res.ok) throw new ApiRequestError("http_error", `Health check failed (${res.status})`, res.status);
    return (await res.json()) as HealthResponse;
  },
  analyse: (body: AnalyseRequest) => post<AnalyseRequest, AnalyseResponse>("/api/analyse", body),
  suggest: (body: SuggestRequest) => post<SuggestRequest, SuggestResponse>("/api/suggest", body),
  ask: (body: AskRequest) => post<AskRequest, AskResponse>("/api/ask", body),
};
