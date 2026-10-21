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

/**
 * pi-ai's Gemini streams with two Gemini quirks:
 *
 * - **Grounding** (`grounding`): every request gets the Google Search and URL context tools,
 *   appended through `onPayload` after the caller's own `onPayload`.
 * - **Prompt blocks**: Gemini reports a blocked prompt only as `promptFeedback.blockReason` on a
 *   chunk without candidates, which pi-ai surfaces as a stream that ended without a finish reason.
 *   The block reason is copied to the final message's `rawStopReason` when pi-ai set none.
 */
export function googleChatStreams(inner: ProviderStreams, grounding: boolean): ProviderStreams {
  return {
    ...inner,
    stream: (model, context, options) => withPromptBlockReason(options, (hooked) => inner.stream(model, context, hooked), grounding),
    streamSimple: (model, context, options) =>
      withPromptBlockReason(options, (hooked) => inner.streamSimple(model, context, hooked), grounding),
  };
}

function withPromptBlockReason<T extends StreamOptions | SimpleStreamOptions>(
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
  return mapFinalMessage(run(hooked), (message) =>
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

/** The stream with its final message (`done` or `error`) passed through `map`; every other event unchanged. */
function mapFinalMessage(
  source: AssistantMessageEventStream,
  map: (message: AssistantMessage) => AssistantMessage,
): AssistantMessageEventStream {
  const target = createAssistantMessageEventStream();
  void (async () => {
    try {
      for await (const event of source) {
        if (event.type === "done") target.push({ ...event, message: map(event.message) });
        else if (event.type === "error") target.push({ ...event, error: map(event.error) });
        else target.push(event);
      }
    } finally {
      target.end();
    }
  })().catch(() => undefined);
  return target;
}
