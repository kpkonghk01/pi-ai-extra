import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type Context,
  type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { untilAborted } from "./abort.ts";
import { errorText, TurnFailure } from "./errors.ts";
import { parseKitOptions, type TurnOptions } from "./input.ts";
import { chatModel } from "./models/info.ts";
import {
  kitAborted,
  classifyOutcome,
  kitFailed,
  failedFrom,
  type ChatFinalEvent,
  type TurnRun,
  type TurnState,
} from "./outcome.ts";
import { prepareTurn, type PreparedTurn, type TurnTarget } from "./prepare.ts";
import { createProviderRegistry, type ProviderRegistry } from "./registry.ts";
import { forcedCallAnswer, PASS_THROUGH } from "./schema-answer.ts";
import type { ChatKit, ChatKitOptions, ChatModelRef, ChatProviderModels, ChatTurnStream } from "./types.ts";

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
export function createChatKit(options: ChatKitOptions): ChatKit {
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
  const callerSignal = signalOf(options);
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
      if (controller.signal.aborted) return finish(kitAborted(target));
      let turn: PreparedTurn;
      try {
        turn = await prepareTurn(registry, ref, context, options, target, controller.signal);
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
    ...(turn.wire.suppressedHeaders === undefined ? {} : { headers: { ...turn.wire.suppressedHeaders } }),
    ...(turn.wire.acceptsFetch ? { fetch: statusRecordingFetch(kitFetch ?? turn.providerFetch, run.state) } : {}),
  };

  // With a forced tool call the answer is the tool's arguments: they become text events.
  const answer = turn.schemaAsToolCall ? forcedCallAnswer() : PASS_THROUGH;
  for await (const event of turn.send(turn.model, turn.context, options)) {
    if (event.type === "done" || event.type === "error") {
      const { content } = event.type === "done" ? event.message : event.error;
      return finish(classifyOutcome(run, event, answer.finalContent(content)));
    }
    for (const out of answer.translate(event)) stream.push(out);
  }
  finish(endedWithoutResult(turn));
}

/** The turn's own failure when pi-ai's stream ended without a final event, with the model's `api`. */
function endedWithoutResult(turn: PreparedTurn): ChatFinalEvent {
  return kitFailed(turn.target, "PROVIDER_ERROR", "The provider stream ended without a result.");
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
  const part = (value: unknown) => (typeof value === "string" && value ? value : "?");
  try {
    const record = (typeof ref === "object" && ref !== null ? ref : {}) as Partial<Record<"provider" | "id", unknown>>;
    return { provider: part(record.provider), model: part(record.id) };
  } catch {
    // A getter or proxy that throws: `parseTurn` answers INVALID_REQUEST.
    return { provider: "?", model: "?" };
  }
}

/** The caller's abort signal, or none when the options have none or cannot be read (`parseTurn` answers INVALID_REQUEST). */
function signalOf(options: TurnOptions | undefined): AbortSignal | undefined {
  try {
    return options?.signal instanceof AbortSignal ? options.signal : undefined;
  } catch {
    return undefined;
  }
}
