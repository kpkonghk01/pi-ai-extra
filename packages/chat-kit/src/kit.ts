import type { ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { errorText, TurnFailure } from "./errors.ts";
import { parseKitOptions } from "./input.ts";
import { classifyOutcome, failed, failedFrom, type TurnRun, type TurnState } from "./outcome.ts";
import { prepareTurn, type PreparedTurn, type TurnTarget } from "./prepare.ts";
import { createProviderRegistry, type RegisteredProvider } from "./registry.ts";
import type { ChatKit, ChatKitOptions, ChatTurnEvent, ChatTurnInput } from "./types.ts";

/**
 * pi-ai retries only the initial request, before the response stream starts (408, 409, 429, 5xx
 * and connection errors, with backoff and `Retry-After`). A turn is never re-sent after its first
 * token, and never to another provider or model.
 */
const MAX_REQUEST_RETRIES = 2;

/**
 * Creates the chat kit. Each provider is registered with its explicit key under the consumer's
 * name; an invalid configuration (unknown provider, duplicate name, missing key, grounding on a
 * provider other than Google) throws a `TypeError` here.
 */
export function createChatKit(options: ChatKitOptions): ChatKit {
  const { providers, fetch } = parseKitOptions(options);
  const registry = createProviderRegistry(providers);
  return {
    runTurn: (input, turnOptions) => runTurn(registry, fetch, input, turnOptions?.signal),
  };
}

async function* runTurn(
  registry: ReadonlyMap<string, RegisteredProvider>,
  kitFetch: typeof globalThis.fetch | undefined,
  input: ChatTurnInput,
  callerSignal: AbortSignal | undefined,
): AsyncGenerator<ChatTurnEvent, void, undefined> {
  // Our own controller also stops the request when the consumer stops iterating early.
  const controller = new AbortController();
  const abort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  const target = targetOf(input);
  try {
    if (controller.signal.aborted) {
      yield failed(target, "ABORTED", "The turn was aborted.");
      return;
    }
    let turn: PreparedTurn;
    try {
      turn = await prepareTurn(registry, input, target, controller.signal);
    } catch (error) {
      yield failedFrom(target, error, controller.signal);
      return;
    }
    yield* streamTurn(turn, kitFetch, controller.signal);
  } catch (error) {
    // Last resort: a turn never throws.
    yield failedFrom(target, error, controller.signal);
  } finally {
    callerSignal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

async function* streamTurn(
  turn: PreparedTurn,
  kitFetch: typeof globalThis.fetch | undefined,
  signal: AbortSignal,
): AsyncGenerator<ChatTurnEvent, void, undefined> {
  const run: TurnRun = { turn, observer: turn.wire.createObserver(), state: { transformFailure: undefined, httpStatus: undefined }, signal };
  const { schemaAsToolCall } = turn;
  const { temperature, maxOutputTokens, reasoning } = turn.settings;
  const options: ModelsSimpleStreamOptions = {
    signal,
    cacheRetention: "short",
    maxRetries: MAX_REQUEST_RETRIES,
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { maxTokens: maxOutputTokens }),
    ...(reasoning === undefined ? {} : { reasoning }),
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

  for await (const event of turn.provider.streamSimple(turn.model, turn.context, options)) {
    switch (event.type) {
      case "text_delta":
        // With a forced tool call the answer is the tool's arguments, never free text.
        if (!schemaAsToolCall && event.delta) yield { type: "text", delta: event.delta };
        break;
      case "toolcall_delta":
        // pi-ai's Anthropic adapter passes each `input_json_delta` through unchanged.
        if (schemaAsToolCall && event.delta) yield { type: "text", delta: event.delta };
        break;
      case "done":
      case "error":
        yield classifyOutcome(run, event);
        return;
      default:
        // Thinking is never streamed as text.
        break;
    }
  }
  yield failed(turn.target, "PROVIDER_ERROR", "The provider stream ended without a result.");
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

/** `?` stands in for a provider or model the input does not name (malformed input only). */
function targetOf(input: ChatTurnInput): TurnTarget {
  const record = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<"provider" | "model", unknown>>;
  const part = (value: unknown) => (typeof value === "string" && value ? value : "?");
  return { provider: part(record.provider), model: part(record.model) };
}
