import { isModelType, type Api, type FetchFunction, type Model, type Provider, type ProviderStreams } from "@earendil-works/pi-ai";

/**
 * The provider with a live chat model list: each `refreshModels` reads it with `readLive` and
 * replaces the chat models, so a model the provider drops disappears. pi-ai's
 * `createProvider({ fetchModels })` would merge the read over the baseline instead, and never
 * remove a model. Until the first read succeeds, and after a failed one, the chat models are the
 * last list in place: the base provider's at first. Image and classifier models stay the base
 * provider's.
 *
 * The read uses the key the factory bound, and is not persisted: `refreshModels` restores nothing
 * from `context.stored`, and reads only when `context.allowNetwork` is set. A read that throws
 * keeps the previous list, and the error reaches pi-ai's `Models.refresh()` result.
 */
export function withLiveChatModels<TApi extends Api>(
  base: Provider<TApi>,
  readLive: (signal: AbortSignal) => Promise<readonly Model<TApi>[]>,
): Provider<TApi> {
  let live: readonly Model<TApi>[] | undefined;
  const chatModels = (): readonly Model<TApi>[] => live ?? base.getModels();
  return {
    ...base,
    getModels: chatModels,
    getAllModels: () => [...chatModels(), ...(base.getAllModels?.() ?? []).filter((model) => !isModelType(model, "chat"))],
    async refreshModels(context) {
      if (!context.allowNetwork || context.signal.aborted) return;
      const models = await readLive(context.signal);
      if (context.signal.aborted) return;
      await context.publish({
        update: () => {
          live = models;
        },
      });
    },
  };
}

/** Streams that send with `fetch` unless the request brings its own (`StreamOptions.fetch`). */
export function withDefaultFetch(inner: ProviderStreams, fetch: FetchFunction | undefined): ProviderStreams {
  if (fetch === undefined) return inner;
  return {
    ...inner,
    stream: (model, context, options) => inner.stream(model, context, { ...options, fetch: options?.fetch ?? fetch }),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, { ...options, fetch: options?.fetch ?? fetch }),
  };
}
