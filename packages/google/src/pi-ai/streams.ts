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
 * - **A result always arrives**: a stream that ends without a final event, or throws, gets one: the
 *   result it completed with through `end(result)`, else an `error` message (`aborted` when the
 *   request's signal was aborted) that keeps the content streamed so far, so `result()` settles.
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

/** How a source that gave no final event ended: it threw (`error` is whatever it threw, even `undefined`), or it just ended. */
type EndedEarly = { threw: true; error: unknown } | { threw: false };

/**
 * The stream with its final message (`done` or `error`) passed through `map`; every other event
 * unchanged. A source that ends without a final event, or throws, still gets one, for `requested`: the
 * result the source completed with through `end(result)`, else an `error` message (`aborted` when
 * `signal` was aborted) that keeps the content streamed so far. So `result()` always settles,
 * which pi-ai's `lazyStream` relies on.
 */
function mapFinalMessage(
  source: AssistantMessageEventStream,
  requested: Model<Api>,
  signal: AbortSignal | undefined,
  map: (message: AssistantMessage) => AssistantMessage,
): AssistantMessageEventStream {
  const target = createAssistantMessageEventStream();
  void (async () => {
    let finished = false;
    let streamed: AssistantMessage["content"] = [];
    let ended: EndedEarly = { threw: false };
    try {
      for await (const event of source) {
        if (event.type === "done") target.push({ ...event, message: map(event.message) });
        else if (event.type === "error") target.push({ ...event, error: map(event.error) });
        else {
          target.push(event);
          streamed = event.partial.content;
        }
        finished ||= event.type === "done" || event.type === "error";
      }
    } catch (error) {
      ended = { threw: true, error };
    }
    if (!finished) {
      const result = ended.threw ? undefined : await completedResult(source);
      pushFinal(target, map(result ?? endedWithoutResult(requested, signal, ended, streamed)));
    }
    target.end();
  })();
  return target;
}

/** The final event for `message`, which must be a final one: `done` for a stop, length or tool use, else `error` or `aborted`. */
function pushFinal(target: AssistantMessageEventStream, message: AssistantMessage): void {
  const { stopReason } = message;
  if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse" || stopReason === "deferred") {
    target.push({ type: "done", reason: stopReason, message });
  } else if (stopReason === "aborted") {
    target.push({ type: "error", reason: stopReason, error: message });
  } else {
    // "error", or "pending", which is not a final state: ending the turn on it is an error.
    const error = stopReason === "error" ? message : { ...message, stopReason: "error" as const, errorMessage: `The Gemini stream ended with a ${stopReason} result.` };
    target.push({ type: "error", reason: "error", error });
  }
}

/**
 * The message a source completed with through `end(result)` but never pushed as a final event, if it
 * did so by the next macrotask. A source that has no `result()` (pi-ai's `lazyStream` tolerates one)
 * has none.
 */
async function completedResult(source: AssistantMessageEventStream): Promise<AssistantMessage | undefined> {
  if (typeof source.result !== "function") return undefined;
  return Promise.race([source.result(), new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined)))]);
}

function endedWithoutResult(
  model: Model<Api>,
  signal: AbortSignal | undefined,
  ended: EndedEarly,
  streamed: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content: streamed,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: signal?.aborted === true ? "aborted" : "error",
    errorMessage: !ended.threw ? "The Gemini stream ended without a result." : ended.error instanceof Error ? ended.error.message : String(ended.error),
    timestamp: Date.now(),
  };
}
