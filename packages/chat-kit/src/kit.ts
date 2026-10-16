import type { Api, AssistantMessage, Context, Message, Model, ModelsSimpleStreamOptions, Usage } from "@earendil-works/pi-ai";
import {
  createDocumentMarker,
  documentKind,
  prepareDocument,
  SUPPORTED_DOCUMENT_TYPES,
  type DocumentKind,
  type PreparedDocument,
} from "./documents.ts";
import { statusFromMessage, TurnFailure } from "./errors.ts";
import { parseKitOptions, parseTurnInput } from "./input.ts";
import { createProviderRegistry, type RegisteredProvider } from "./registry.ts";
import type {
  ChatDocument,
  ChatKit,
  ChatKitOptions,
  ChatTurnError,
  ChatTurnErrorCode,
  ChatTurnEvent,
  ChatTurnInput,
  ChatTurnSettings,
  ChatUsage,
} from "./types.ts";
import { toChatUsage } from "./usage.ts";
import { wireApiFor, type PayloadPlan, type StreamObserver, type WireApi } from "./wire/index.ts";

/**
 * pi-ai retries only the initial request, before the response stream starts (408, 409, 429, 5xx
 * and connection errors, with backoff and `Retry-After`). A turn is never re-sent after its first
 * token, and never to another provider or model.
 */
const MAX_REQUEST_RETRIES = 2;

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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

interface PreparedTurn {
  label: string;
  provider: RegisteredProvider;
  model: Model<Api>;
  wire: WireApi;
  context: Context;
  plan: PayloadPlan;
  settings: ChatTurnSettings;
  /** The answer is the arguments of a forced tool call (a response schema on Anthropic Messages). */
  schemaAsToolCall: boolean;
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
  const label = labelOf(input);
  try {
    if (controller.signal.aborted) {
      yield failed(label, "ABORTED", "The turn was aborted.");
      return;
    }
    let turn: PreparedTurn;
    try {
      turn = await prepareTurn(registry, input, label, controller.signal);
    } catch (error) {
      yield failedFrom(label, error, controller.signal);
      return;
    }
    yield* streamTurn(turn, kitFetch, controller.signal);
  } catch (error) {
    // Last resort: a turn never throws.
    yield failedFrom(label, error, controller.signal);
  } finally {
    callerSignal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

/** Everything checked before any document is loaded or any request is sent. */
async function prepareTurn(
  registry: ReadonlyMap<string, RegisteredProvider>,
  input: ChatTurnInput,
  label: string,
  signal: AbortSignal,
): Promise<PreparedTurn> {
  const validation = parseTurnInput(input);
  if (!validation.ok) throw new TurnFailure("INVALID_REQUEST", `Invalid turn input: ${validation.message}`);
  const provider = registry.get(input.provider);
  if (!provider) throw new TurnFailure("UNKNOWN_MODEL", `No provider named ${JSON.stringify(input.provider)} is configured.`);
  const model = provider.findModel(input.model);
  if (!model) {
    throw new TurnFailure("UNKNOWN_MODEL", `Model ${JSON.stringify(input.model)} is not in the ${provider.kind} chat catalogue.`);
  }
  const wire = wireApiFor(model.api);
  if (!wire) throw new TurnFailure("UNSUPPORTED", `chat-kit does not support the ${JSON.stringify(model.api)} API of this model.`);
  const settings = input.settings ?? {};
  const kinds = input.documents.map((document) => checkDocument(document, provider, model));
  const unsupported = wire.unsupported(model, { responseSchema: input.responseSchema, settings });
  if (unsupported) throw new TurnFailure("UNSUPPORTED", `This model cannot take this request: ${unsupported}`);

  const documents = await untilAborted(
    Promise.all(input.documents.map((document, index) => loadDocument(document, kinds[index]!, wire, model))),
    signal,
  );
  const marker = documents.length > 0 ? createDocumentMarker() : undefined;
  return {
    label,
    provider,
    model,
    wire,
    context: buildContext(input, model, marker),
    plan: { marker, documents, responseSchema: input.responseSchema, grounding: provider.grounding },
    settings,
    schemaAsToolCall: wire.schemaAsToolCall && input.responseSchema !== undefined,
  };
}

function checkDocument(document: ChatDocument, provider: RegisteredProvider, model: Model<Api>): DocumentKind {
  const kind = documentKind(document.mimeType);
  if (kind === undefined) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Document ${JSON.stringify(document.name)} has type ${JSON.stringify(document.mimeType)}; supported types are ${SUPPORTED_DOCUMENT_TYPES.join(", ")}.`,
    );
  }
  if (kind === "text") return kind;
  if (!provider.documents.files) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Provider ${provider.kind} does not take PDF or image documents yet (its file input is undocumented), so ${JSON.stringify(document.name)} cannot be sent.`,
    );
  }
  if (!model.input.includes("image")) {
    throw new TurnFailure("UNSUPPORTED", `Model ${model.id} takes text only, so it cannot read ${JSON.stringify(document.name)}.`);
  }
  return kind;
}

async function loadDocument(document: ChatDocument, kind: DocumentKind, wire: WireApi, model: Model<Api>): Promise<PreparedDocument> {
  try {
    return await prepareDocument(document, kind, wire.placeDocument(document, model));
  } catch (error) {
    throw new TurnFailure("INVALID_REQUEST", `Document ${JSON.stringify(document.name)} could not be loaded: ${errorText(error)}`, {
      cause: error,
    });
  }
}

/**
 * The transcript: system prompt, history, then the new message. The documents' marker opens the
 * first user turn (the first user message of the history, otherwise the new message), so the
 * prompt is identical across turns, and across sessions of the same documents, up to the end of
 * the documents, which lets provider prompt caching reuse it.
 */
function buildContext(input: ChatTurnInput, model: Model<Api>, marker: string | undefined): Context {
  const firstUser = input.history.findIndex((entry) => entry.role === "user");
  const timestamp = Date.now();
  const user = (text: string, withMarker: boolean): Message => ({
    role: "user",
    content:
      withMarker && marker !== undefined
        ? [
            { type: "text", text: marker },
            { type: "text", text },
          ]
        : text,
    timestamp,
  });
  const messages: Message[] = input.history.map((entry, index) =>
    entry.role === "user"
      ? user(entry.text, index === firstUser)
      : {
          role: "assistant",
          content: [{ type: "text", text: entry.text }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: ZERO_USAGE,
          stopReason: "stop",
          timestamp,
        },
  );
  messages.push(user(input.message, firstUser === -1));
  return { ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}), messages };
}

async function* streamTurn(
  turn: PreparedTurn,
  kitFetch: typeof globalThis.fetch | undefined,
  signal: AbortSignal,
): AsyncGenerator<ChatTurnEvent, void, undefined> {
  const observer = turn.wire.createObserver();
  const { schemaAsToolCall } = turn;
  const state: TurnState = { transformFailure: undefined, httpStatus: undefined };
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
        state.transformFailure =
          error instanceof TurnFailure
            ? error
            : new TurnFailure("UNSUPPORTED", `chat-kit could not build the request: ${errorText(error)}`);
        throw state.transformFailure;
      }
    },
    onProviderStreamEvent: (event) => observer.observe(event),
    ...(turn.wire.acceptsFetch ? { fetch: statusRecordingFetch(kitFetch, state) } : {}),
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
        yield finish(turn, event.message, false, observer, state, signal);
        return;
      case "error":
        yield finish(turn, event.error, true, observer, state, signal);
        return;
      default:
        // Thinking is never streamed as text.
        break;
    }
  }
  yield failed(turn.label, "PROVIDER_ERROR", "The provider stream ended without a result.");
}

interface TurnState {
  transformFailure: TurnFailure | undefined;
  httpStatus: number | undefined;
}

/** Classifies the final pi-ai message: done, or failed with the most specific code. */
function finish(
  turn: PreparedTurn,
  message: AssistantMessage,
  errored: boolean,
  observer: StreamObserver,
  state: TurnState,
  signal: AbortSignal,
): ChatTurnEvent {
  const raw = observer.rawUsage();
  const usage = toChatUsage(message.usage, raw);
  // Usage goes on a failure only when the provider reported it (Gemini bills blocked prompts).
  const reported = raw === undefined ? undefined : usage;
  if (state.transformFailure) return failed(turn.label, state.transformFailure.code, state.transformFailure.message);
  if (errored && (message.stopReason === "aborted" || signal.aborted)) {
    return failed(turn.label, "ABORTED", "The turn was aborted.", { usage: reported });
  }
  const blocked = observer.blocked(message);
  if (blocked) return failed(turn.label, "CONTENT_BLOCKED", blocked.message, { reason: blocked.reason, usage: reported });
  const rawReason = message.rawStopReason;
  if (!errored) {
    const answered = turn.schemaAsToolCall
      ? message.stopReason === "toolUse" && message.content.some((block) => block.type === "toolCall")
      : message.stopReason === "stop";
    if (answered) return { type: "done", usage };
    const reason = rawReason ?? message.stopReason;
    if (message.stopReason === "length") {
      // A free-form answer cut off at the output-token limit is still an answer: the text already
      // streamed stands, marked `truncated`. A cut-off response-schema answer (JSON text, or a forced
      // tool call's arguments on Anthropic Messages) cannot be parsed, so that turn fails.
      if (turn.plan.responseSchema === undefined) return { type: "done", usage, truncated: true };
      return failed(turn.label, "PROVIDER_ERROR", "The answer hit the output-token limit, so its response-schema JSON is incomplete.", {
        reason,
        usage: reported,
      });
    }
    const text = turn.schemaAsToolCall
      ? "The model answered without the response-schema tool call."
      : `The provider stopped with ${message.stopReason}.`;
    return failed(turn.label, "PROVIDER_ERROR", text, { reason, usage: reported });
  }
  const errorMessage = message.errorMessage ?? "The provider request failed.";
  return failed(turn.label, "PROVIDER_ERROR", errorMessage, {
    reason: rawReason,
    status: state.httpStatus ?? statusFromMessage(errorMessage),
    usage: reported,
  });
}

function failed(
  label: string,
  code: ChatTurnErrorCode,
  message: string,
  extra: { reason?: string | undefined; status?: number | undefined; usage?: ChatUsage | undefined } = {},
): ChatTurnEvent {
  const error: ChatTurnError = {
    code,
    message: `${label} ${message}`,
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.status === undefined ? {} : { status: extra.status }),
  };
  return extra.usage === undefined ? { type: "failed", error } : { type: "failed", error, usage: extra.usage };
}

function failedFrom(label: string, error: unknown, signal: AbortSignal): ChatTurnEvent {
  if (error instanceof TurnFailure) return failed(label, error.code, error.message);
  if (signal.aborted) return failed(label, "ABORTED", "The turn was aborted.");
  return failed(label, "PROVIDER_ERROR", errorText(error));
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

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const aborted = () => new TurnFailure("ABORTED", "The turn was aborted.");
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function labelOf(input: ChatTurnInput): string {
  const record = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<"provider" | "model", unknown>>;
  const part = (value: unknown) => (typeof value === "string" && value ? value : "?");
  return `[${part(record.provider)}/${part(record.model)}]`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
