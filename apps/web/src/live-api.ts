import type {
  ChatsResponse,
  LatestAnalysisResponse,
  LiveAnalyseResponse,
  LiveEvent,
  MessagesResponse,
  SendResponse,
  WhatsAppStatusResponse,
} from "@homeair/shared";
import { ApiRequestError } from "./api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let err = { error: `Request failed (${res.status})`, code: "http_error" };
    try {
      err = (await res.json()) as typeof err;
    } catch {
      /* non-JSON */
    }
    throw new ApiRequestError(err.code, err.error, res.status);
  }
  return (await res.json()) as T;
}

export const live = {
  status: () => request<WhatsAppStatusResponse>("/api/whatsapp/status"),
  connect: () => request<{ ok: true }>("/api/whatsapp/connect", { method: "POST" }),
  logout: () => request<{ ok: true }>("/api/whatsapp/logout", { method: "POST" }),
  chats: () => request<ChatsResponse>("/api/chats"),
  enable: (id: string) => request<{ ok: true }>(`/api/chats/${encodeURIComponent(id)}/enable`, { method: "POST" }),
  disable: (id: string) => request<{ ok: true }>(`/api/chats/${encodeURIComponent(id)}/disable`, { method: "POST" }),
  messages: (id: string, limit = 100) => request<MessagesResponse>(`/api/chats/${encodeURIComponent(id)}/messages?limit=${limit}`),
  latestAnalysis: (id: string) => request<LatestAnalysisResponse>(`/api/chats/${encodeURIComponent(id)}/analysis`),
  analyse: (id: string, force: boolean) =>
    request<LiveAnalyseResponse>(`/api/chats/${encodeURIComponent(id)}/analyse`, { method: "POST", body: JSON.stringify({ force }) }),
  /** The only call in the UI that sends anything. Wired to the SEND button after a confirm tap. */
  send: (id: string, text: string) =>
    request<SendResponse>(`/api/chats/${encodeURIComponent(id)}/send`, { method: "POST", body: JSON.stringify({ text }) }),
};

/** Subscribes to server-sent events; reconnects automatically (EventSource does that). */
export function subscribeLive(onEvent: (event: LiveEvent) => void, onOpen?: () => void): () => void {
  const source = new EventSource("/api/events");
  const types: LiveEvent["type"][] = ["status", "chats", "message", "analysing", "analysis", "analysis_skipped", "error"];
  for (const type of types) {
    source.addEventListener(type, (e) => {
      try {
        onEvent(JSON.parse((e as MessageEvent).data) as LiveEvent);
      } catch {
        /* ignore malformed */
      }
    });
  }
  if (onOpen) source.onopen = onOpen;
  return () => source.close();
}
