import type { FetchFunction, ProviderStreams } from "@earendil-works/pi-ai";

/** Streams that send with `fetch` unless the request brings its own (`StreamOptions.fetch`). */
export function withDefaultFetch(inner: ProviderStreams, fetch: FetchFunction | undefined): ProviderStreams {
  if (fetch === undefined) return inner;
  return {
    ...inner,
    stream: (model, context, options) => inner.stream(model, context, { ...options, fetch: options?.fetch ?? fetch }),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, { ...options, fetch: options?.fetch ?? fetch }),
  };
}
