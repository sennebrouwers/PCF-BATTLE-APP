const pendingGets = new Map<string, Promise<unknown>>();
const GET_TIMEOUT_MS = 15_000;

export class ClientApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  constructor(message: string, response: Response, data: unknown) {
    super(message);
    this.name = "ClientApiError";
    this.status = response.status;
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.code === "string") this.code = record.code;
      if (record.fields && typeof record.fields === "object") this.fields = record.fields as Record<string, string>;
    }
  }
}

// Legacy feature components still consume heterogeneous endpoint shapes; callers should
// provide a concrete generic as they are migrated to typed DTOs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clientApi<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || "GET").toUpperCase();
  const key = method === "GET" && !options.signal ? path : "";
  if (key && pendingGets.has(key)) return pendingGets.get(key) as Promise<T>;
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = method === "GET" ? window.setTimeout(() => controller.abort(), GET_TIMEOUT_MS) : undefined;
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  const request = fetch(`/api${path}`, { ...options, headers, credentials: "same-origin", signal: controller.signal })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const details = Array.isArray(record.conflicts) ? `: ${record.conflicts.map((item) => item && typeof item === "object" && "message" in item ? String(item.message) : String(item)).join("; ")}` : "";
        const message = (typeof record.error === "string" ? record.error : `Request failed (${response.status})`) + details;
        throw new ClientApiError(message, response, data);
      }
      return data as T;
    })
    .finally(() => {
      if (timeout) window.clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
      if (key) pendingGets.delete(key);
      if (typeof performance !== "undefined" && typeof performance.measure === "function") {
        try { performance.measure(`pcf-api:${method}:${path}`, { duration: performance.now() - startedAt }); } catch {}
      }
    });
  if (key) pendingGets.set(key, request);
  return request;
}
