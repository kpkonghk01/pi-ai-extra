import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { isRecord } from "@hk01/pi-ai-extra-internal";
import { zeroUsage } from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * pi-ai's Gemini streams with two Gemini quirks, and one guarantee:
 *
 * - **Grounding** (`grounding`): every request gets the Google Search and URL context tools,
 *   appended through `onPayload` after the caller's own `onPayload`.
 * - **Prompt blocks**: Gemini reports a blocked prompt only as `promptFeedback.blockReason` on a
 *   chunk without candidates, which pi-ai surfaces as a stream that ended without a finish reason.
 *   The block reason is copied to the final message's `rawStopReason` when pi-ai set none.
 * - **A result always arrives**: a stream that ends without a final event, or throws, gets an
 *   `error` message (`aborted` when the request's signal was aborted), so `result()` settles.
 */
export function googleChatStreams(inner: ProviderStreams, grounding: boolean): ProviderStreams {
  return {
    ...inner,
    stream: (model, context, options) => withPromptBlockReason(model, options, (hooked) => inner.stream(model, context, hooked), grounding),
    streamSimple: (model, context, options) =>
      withPromptBlockReason(model, options, (hooked) => inner.streamSimple(model, context, hooked), grounding),
  };
}

function withPromptBlockReason<T extends StreamOptions | SimpleStreamOptions>(
  requested: Model<Api>,
  options: T | undefined,
  run: (options: T) => AssistantMessageEventStream,
  grounding: boolean,
): AssistantMessageEventStream {
  let blockReason: string | undefined;
  const hooked = {
    ...options,
    ...(grounding
      ? {
          onPayload: async (payload: unknown, model: Model<Api>) => {
            const next = await options?.onPayload?.(payload, model);
            return withGroundingTools(next === undefined ? payload : next);
          },
        }
      : {}),
    onProviderStreamEvent: async (event: unknown, model: Model<Api>) => {
      const reason = promptBlockReason(event);
      if (reason !== undefined) blockReason = reason;
      await options?.onProviderStreamEvent?.(event, model);
    },
  } as T;
  return mapFinalMessage(run(hooked), requested, options?.signal, (message) =>
    blockReason === undefined || message.rawStopReason !== undefined ? message : { ...message, rawStopReason: blockReason },
  );
}

/** Appends the Google Search and URL context tools to a `GenerateContentParameters` payload's `config.tools`. */
export function withGroundingTools(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const config = isRecord(payload.config) ? payload.config : {};
  const tools = Array.isArray(config.tools) ? config.tools : [];
  return { ...payload, config: { ...config, tools: [...tools, { googleSearch: {} }, { urlContext: {} }] } };
}

function promptBlockReason(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !isRecord(chunk.promptFeedback)) return undefined;
  const reason = chunk.promptFeedback.blockReason;
  return typeof reason === "string" && reason ? reason : undefined;
}

/**
 * The stream with its final message (`done` or `error`) passed through `map`; every other event
 * unchanged. A source that ends without a final event, or throws, still gets one, for `model`:
 * the result the source completed with (`end(result)`), else an `error` message (`aborted` when
 * `signal` was aborted), so `result()` settles. pi-ai's `lazyStream` awaits it.
 */
function mapFinalMessage(
  source: AssistantMessageEventStream,
  model: Model<Api>,
  signal: AbortSignal | undefined,
  map: (message: AssistantMessage) => AssistantMessage,
): AssistantMessageEventStream {
  const target = createAssistantMessageEventStream();
  void (async () => {
    let finished = false;
    let failure: unknown;
    try {
      for await (const event of source) {
        if (event.type === "done") target.push({ ...event, message: map(event.message) });
        else if (event.type === "error") target.push({ ...event, error: map(event.error) });
        else target.push(event);
        finished ||= event.type === "done" || event.type === "error";
      }
    } catch (error) {
      failure = error;
    }
    if (finished) return target.end();
    const message = map(failure === undefined ? await completedResult(source) ?? endedWithoutResult(model, signal, undefined) : endedWithoutResult(model, signal, failure));
    target.push(message.stopReason === "error" || message.stopReason === "aborted" ? { type: "error", reason: message.stopReason, error: message } : { type: "done", reason: message.stopReason as "stop", message });
    target.end();
  })();
  return target;
}

/** The message a source completed with through `end(result)` but never pushed as a final event, if it settled. */
async function completedResult(source: AssistantMessageEventStream): Promise<AssistantMessage | undefined> {
  return Promise.race([source.result(), new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined)))]);
}

function endedWithoutResult(model: Model<Api>, signal: AbortSignal | undefined, failure: unknown): AssistantMessage {
  const aborted = signal?.aborted === true;
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: aborted ? "aborted" : "error",
    errorMessage: failure === undefined ? "The Gemini stream ended without a result." : failure instanceof Error ? failure.message : String(failure),
    timestamp: Date.now(),
  };
}
