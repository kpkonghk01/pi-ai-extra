import type { FetchFunction, ProviderStreams } from "@earendil-works/pi-ai";
import { kieEnvelopeFetch } from "./envelope-fetch.ts";
import { kieFinishReasonFetch } from "./finish-reason-fetch.ts";

/**
 * KIE's chat streams: every request's fetch (the request's own, else the global one) turns KIE's
 * HTTP-200 error envelope into an HTTP error (`kieEnvelopeFetch`), and adds the finish reason KIE
 * leaves out of a Gemini stream on Chat Completions (`kieFinishReasonFetch`).
 */
export function kieChatStreams(inner: ProviderStreams): ProviderStreams {
  const withFetch = <T extends { fetch?: FetchFunction }>(options: T | undefined): T => {
    const base: FetchFunction = options?.fetch ?? ((url, init) => globalThis.fetch(url, init));
    return { ...options, fetch: kieFinishReasonFetch(kieEnvelopeFetch(base)) } as T;
  };
  return {
    stream: (model, context, options) => inner.stream(model, context, withFetch(options)),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, withFetch(options)),
  };
}
