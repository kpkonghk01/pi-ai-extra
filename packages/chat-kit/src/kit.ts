import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { untilAborted } from "./abort.ts";
import { errorText, TurnFailure } from "./errors.ts";
import { parseKitOptions, type TurnOptions } from "./input.ts";
import { chatModel } from "./models/info.ts";
import {
  abortedBeforeSend,
  classifyOutcome,
  failedBeforeSend,
  failedFrom,
  type ChatFinalEvent,
  type TurnRun,
  type TurnState,
} from "./outcome.ts";
import { prepareTurn, type PreparedTurn, type TurnTarget } from "./prepare.ts";
import { createProviderRegistry, type ProviderRegistry } from "./registry.ts";
import type { ChatKit, ChatModelRef, ChatProviderModels, ChatTurnStream } from "./types.ts";

/**
 * pi-ai retries only the initial request, before the response stream starts (408, 409, 429, 5xx
 * and connection errors, with backoff and `Retry-After`). A turn is never re-sent after its first
 * token, and never to another provider or model.
 */
const DEFAULT_MAX_RETRIES = 2;

/**
 * Creates the chat kit over the chat providers the consumer built with the provider packages'
 * factories. Anything that is not a chat provider, or a second provider with the same pi-ai id,
 * throws a `TypeError` here.
 */
export function createChatKit(options: Parameters<typeof parseKitOptions>[0]): ChatKit {
  const { providers, fetch } = parseKitOptions(options);
  const registry = createProviderRegistry(providers);
  const streamSimple = (model: ChatModelRef, context: Context, turnOptions?: TurnOptions): ChatTurnStream =>
    startTurn(registry, fetch, model, context, turnOptions);
  return {
    streamSimple,
    completeSimple: (model: ChatModelRef, context: Context, turnOptions?: TurnOptions) =>
      streamSimple(model, context, turnOptions).result(),
    listModels: (listOptions) => listModels(registry, listOptions?.signal),
  } as ChatKit;
}

/** Every provider's list, each read on its own: one that fails becomes an `error` entry. */
async function listModels(registry: ProviderRegistry, signal: AbortSignal | undefined): Promise<ChatProviderModels[]> {
  const listed = Promise.all(
    [...registry.providers.values()].map(async (provider): Promise<ChatProviderModels> => {
      try {
        const snapshot = await provider.models.read();
        return {
          provider: provider.id,
          source: snapshot.source,
          ...(snapshot.fetchedAt === undefined ? {} : { fetchedAt: new Date(snapshot.fetchedAt).toISOString() }),
          ...(snapshot.refreshError === undefined ? {} : { refreshError: snapshot.refreshError }),
          models: snapshot.models.map((model) => chatModel(model, provider.traits)),
        };
      } catch (error) {
        return { provider: provider.id, error: errorText(error) };
      }
    }),
  );
  return untilAborted(listed, signal, () => signal?.reason);
}

/** Starts a turn: the stream is returned at once, and the turn runs behind it. It never throws. */
function startTurn(
  registry: ProviderRegistry,
  kitFetch: typeof globalThis.fetch | undefined,
  ref: ChatModelRef,
  context: Context,
  options: TurnOptions | undefined,
): ChatTurnStream {
  const stream = createAssistantMessageEventStream();
  const target = targetOf(ref);
  const callerSignal = options?.signal instanceof AbortSignal ? options.signal : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  const finish = (final: ChatFinalEvent) => {
    stream.push(final);
    stream.end(final.type === "done" ? final.message : final.error);
  };
  void (async () => {
    try {
      if (controller.signal.aborted) return finish(abortedBeforeSend(target));
      let turn: PreparedTurn;
      try {
        turn = await prepareTurn(registry, ref, context, options === undefined ? undefined : { ...options, signal: controller.signal }, target);
      } catch (error) {
        return finish(failedFrom(target, error, controller.signal));
      }
      await streamTurn(turn, kitFetch, controller.signal, stream, finish);
    } catch (error) {
      // Last resort: a turn never throws.
      finish(failedFrom(target, error, controller.signal));
    } finally {
      callerSignal?.removeEventListener("abort", abort);
      controller.abort();
    }
  })();
  return stream as ChatTurnStream;
}

async function streamTurn(
  turn: PreparedTurn,
  kitFetch: typeof globalThis.fetch | undefined,
  signal: AbortSignal,
  stream: { push(event: AssistantMessageEvent): void },
  finish: (final: ChatFinalEvent) => void,
): Promise<void> {
  const run: TurnRun = { turn, observer: turn.wire.createObserver(), state: { transformFailure: undefined, httpStatus: undefined }, signal };
  const { schemaAsToolCall } = turn;
  const { temperature, maxTokens, reasoning, sessionId, toolChoice, maxRetries } = turn.options;
  const options: ModelsSimpleStreamOptions = {
    signal,
    cacheRetention: "short",
    maxRetries: maxRetries ?? DEFAULT_MAX_RETRIES,
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    onPayload: (payload) => {
      try {
        return turn.wire.transform(payload, turn.plan);
      } catch (error) {
        run.state.transformFailure =
          error instanceof TurnFailure
            ? error
            : new TurnFailure("UNSUPPORTED", `chat-kit could not build the request: ${errorText(error)}`);
        throw run.state.transformFailure;
      }
    },
    onProviderStreamEvent: (event) => run.observer.observe(event),
    ...(turn.wire.acceptsFetch ? { fetch: statusRecordingFetch(kitFetch, run.state) } : {}),
  };

  // With a forced tool call the answer is the tool's arguments: they become text events.
  const answers = new Map<number, string>();
  const asText = (message: AssistantMessage): AssistantMessage =>
    schemaAsToolCall
      ? {
          ...message,
          content: message.content.map((block, index) =>
            block.type === "toolCall" ? { type: "text" as const, text: answers.get(index) ?? JSON.stringify(block.arguments) } : block,
          ),
        }
      : message;

  for await (const event of turn.send(turn.model, turn.context, options)) {
    switch (event.type) {
      case "done":
      case "error":
        return finish(classifyOutcome(run, event, asText(event.type === "done" ? event.message : event.error).content));
      case "toolcall_start":
        if (!schemaAsToolCall) stream.push(event);
        else {
          answers.set(event.contentIndex, "");
          stream.push({ type: "text_start", contentIndex: event.contentIndex, partial: asText(event.partial) });
        }
        break;
      case "toolcall_delta":
        if (!schemaAsToolCall) stream.push(event);
        else {
          answers.set(event.contentIndex, (answers.get(event.contentIndex) ?? "") + event.delta);
          stream.push({ type: "text_delta", contentIndex: event.contentIndex, delta: event.delta, partial: asText(event.partial) });
        }
        break;
      case "toolcall_end":
        if (!schemaAsToolCall) stream.push(event);
        else {
          const content = answers.get(event.contentIndex) ?? JSON.stringify(event.toolCall.arguments);
          answers.set(event.contentIndex, content);
          stream.push({ type: "text_end", contentIndex: event.contentIndex, content, partial: asText(event.partial) });
        }
        break;
      case "text_start":
      case "text_delta":
      case "text_end":
        // With a forced tool call, free text is never passed off as the schema answer.
        if (!schemaAsToolCall) stream.push(event);
        break;
      default:
        stream.push(schemaAsToolCall ? { ...event, partial: asText(event.partial) } : event);
    }
  }
  finish(failedBeforeSendLike(turn, "The provider stream ended without a result."));
}

/** The turn's own failure when pi-ai's stream ended without a final event, with the model's `api`. */
function failedBeforeSendLike(turn: PreparedTurn, text: string): ChatFinalEvent {
  return failedBeforeSend(turn.target, "PROVIDER_ERROR", text, turn.model.api);
}

/** Records the status of the latest provider response, when it was an error (for `ChatTurnError.status`). */
function statusRecordingFetch(base: typeof globalThis.fetch | undefined, state: TurnState): typeof globalThis.fetch {
  return async (input, init) => {
    state.httpStatus = undefined;
    const response = await (base ?? globalThis.fetch)(input, init);
    if (!response.ok) state.httpStatus = response.status;
    return response;
  };
}

/** `?` stands in for a provider or model the reference does not name (malformed input only). */
function targetOf(ref: ChatModelRef): TurnTarget {
  const record = (typeof ref === "object" && ref !== null ? ref : {}) as Partial<Record<"provider" | "id", unknown>>;
  const part = (value: unknown) => (typeof value === "string" && value ? value : "?");
  return { provider: part(record.provider), model: part(record.id) };
}
