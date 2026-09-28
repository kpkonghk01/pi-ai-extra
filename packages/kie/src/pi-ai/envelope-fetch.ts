import type { FetchFunction, ProviderStreams } from "@earendil-works/pi-ai";

/**
 * KIE reports chat failures (for example an invalid key) as HTTP 200 with its JSON
 * envelope `{ code, msg }` instead of an HTTP error or an SSE stream, which pi-ai's
 * OpenAI/Anthropic adapters would only see as an empty stream. This fetch wrapper
 * turns that envelope into a real HTTP error carrying KIE's code and message.
 * Event streams and successful JSON bodies pass through untouched.
 */
export function kieEnvelopeFetch(base: FetchFunction): FetchFunction {
  return async (input, init) => {
    const response = await base(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return response;
    let body: unknown;
    try {
      body = JSON.parse(await response.clone().text());
    } catch {
      return response;
    }
    if (!isKieErrorEnvelope(body)) return response;
    const status = body.code >= 400 && body.code <= 599 ? body.code : 502;
    const message = `KIE code ${body.code}: ${body.msg}`;
    // No statusText: provider messages may contain characters that are invalid in an HTTP reason phrase.
    return new Response(JSON.stringify({ type: "error", error: { type: "kie_error", code: body.code, message } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

export function kieEnvelopeStreams(inner: ProviderStreams): ProviderStreams {
  const withFetch = <T extends { fetch?: FetchFunction }>(options: T | undefined): T =>
    ({ ...options, fetch: kieEnvelopeFetch(options?.fetch ?? ((url, init) => globalThis.fetch(url, init))) }) as T;
  return {
    stream: (model, context, options) => inner.stream(model, context, withFetch(options)),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, withFetch(options)),
  };
}

function isKieErrorEnvelope(body: unknown): body is { code: number; msg: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return typeof record.code === "number" && record.code !== 200 && typeof record.msg === "string" && !("id" in record) && !("type" in record);
}
