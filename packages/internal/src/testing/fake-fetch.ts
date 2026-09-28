import type { FetchLike } from "../context.ts";

/** Test-only transport double. Not reachable from any public package entry. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | FormData | undefined;
}

export type Responder = (request: RecordedRequest, signal: AbortSignal | undefined) => Response | Promise<Response>;

export interface FakeRoute {
  method: "GET" | "POST";
  /** Exact URL, or a pattern tested against the full URL. */
  url: string | RegExp;
  /** A single responder, or a queue consumed per call (the last entry repeats). */
  respond: Responder | Responder[];
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: RecordedRequest[];
  callsTo(url: string | RegExp): RecordedRequest[];
}

export function createFakeFetch(routes: readonly FakeRoute[]): FakeFetch {
  const calls: RecordedRequest[] = [];
  const counters = new Map<FakeRoute, number>();
  const matches = (pattern: string | RegExp, url: string): boolean =>
    typeof pattern === "string" ? pattern === url : pattern.test(url);

  const fetch: FetchLike = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    const request: RecordedRequest = {
      method,
      url,
      headers: normalizeHeaders(init?.headers),
      body: init?.body as string | FormData | undefined,
    };
    calls.push(request);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw signal.reason;
    const route = routes.find((candidate) => candidate.method === method && matches(candidate.url, url));
    if (!route) throw new Error(`Unexpected request ${method} ${url}`);
    const responders = Array.isArray(route.respond) ? route.respond : [route.respond];
    const count = counters.get(route) ?? 0;
    counters.set(route, count + 1);
    const responder = responders[Math.min(count, responders.length - 1)];
    if (!responder) throw new Error(`No responder for ${method} ${url}`);
    return responder(request, signal);
  };

  return {
    fetch,
    calls,
    callsTo: (url) => calls.filter((call) => matches(url, call.url)),
  };
}

export function jsonResponse(body: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function bytesResponse(bytes: Uint8Array, contentType: string, status: number = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: { "content-type": contentType, "content-length": String(bytes.byteLength) } });
}

export function textResponse(text: string, status: number, contentType: string = "text/plain"): Response {
  return new Response(text, { status, headers: { "content-type": contentType } });
}

/** A request that never answers until its signal aborts (for timeout and cancellation tests). */
export function hangingResponse(_request: RecordedRequest, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Minimal valid 1x1 PNG. */
export const PNG_BYTES: Uint8Array = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  ),
);
/** JPEG magic bytes followed by padding; sufficient for type sniffing. */
export const JPEG_BYTES: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
export const GIF_BYTES: Uint8Array = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

export function dataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function normalizeHeaders(headers: RequestInit["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers ?? {}).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
