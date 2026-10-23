import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderId,
  SimpleStreamOptions,
  StopReason,
} from "@earendil-works/pi-ai";
import type { ChatProvider } from "@hk01/pi-ai-extra-internal/pi-ai";
import type { ModelRate } from "@hk01/pi-ai-extra-internal/rates";

/** What `createChatKit` registers: the chat providers, and a fetch for tests or instrumentation. */
export interface ChatKitOptions {
  /**
   * The chat providers the consumer built with the provider packages' factories, each bound to
   * its own key. Each is registered by its pi-ai id (`provider.id`), which must be unique.
   */
  providers: readonly ChatProvider[];
  /**
   * Custom fetch for tests or instrumentation. Every turn's requests use it instead of the
   * provider's own, except Gemini's: pi-ai's Gemini adapter rejects a custom fetch. Model lists
   * use each provider's own fetch (its factory's `fetch` option).
   */
  fetch?: typeof globalThis.fetch | undefined;
}

/** Options of `ChatKit.listModels`. */
export interface ChatListModelsOptions {
  /** Stops waiting: `listModels` rejects with the signal's reason. A refresh already started still completes. */
  signal?: AbortSignal | undefined;
}

/** Which model a turn runs on: the pi-ai provider id and the provider's model id. A pi-ai `Model` is one. */
export type ChatModelRef = Pick<Model<Api>, "provider" | "id">;

/** Every member optional, and each also accepting `undefined`, for consumers on `exactOptionalPropertyTypes`. */
type Optional<T> = { [K in keyof T]?: T[K] | undefined };

type ChatBaseOptions = Optional<
  Pick<SimpleStreamOptions, "signal" | "temperature" | "maxTokens" | "reasoning" | "sessionId" | "maxRetries"> & {
    documents: readonly ChatDocument[];
  }
>;

/** Options of an agent turn: tools may be in the context, so there is no response schema. */
export type ChatStreamOptions = ChatBaseOptions & Optional<Pick<SimpleStreamOptions, "toolChoice">> & { responseSchema?: undefined };

/** Options of a Gem turn: a tool-free context, with an optional response schema. */
export type ChatSchemaStreamOptions = ChatBaseOptions & Optional<{ responseSchema: ChatResponseSchema }>;

/** pi-ai's `Context` without tools, which a response schema needs. */
export type ChatToolFreeContext = Omit<Context, "tools"> & { tools?: undefined };

/**
 * The chat kit: one interface for calling LLMs, over the chat providers it was created with. A turn
 * runs on exactly the provider and model its reference names, never on another (ADR 0003).
 */
export interface ChatKit {
  /**
   * Runs one turn on exactly the provider and model `model` names: a Gem turn, from a tool-free
   * context, with an optional response schema. It never throws and never falls back to another
   * provider or model: the stream always ends with pi-ai's `done` or `error` event, and the final
   * message carries the chat kit's record under `chatKit`. The model is resolved against the list
   * `listModels` returns.
   */
  streamSimple(model: ChatModelRef, context: ChatToolFreeContext, options?: ChatSchemaStreamOptions): ChatTurnStream;
  /** Runs one turn, as above: an agent turn, whose context may carry tools, without a response schema. */
  streamSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): ChatTurnStream;
  /** `streamSimple(...).result()`: the final message. It never rejects. */
  completeSimple(model: ChatModelRef, context: ChatToolFreeContext, options?: ChatSchemaStreamOptions): Promise<ChatAssistantMessage>;
  /** `streamSimple(...).result()`: the final message. It never rejects. */
  completeSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): Promise<ChatAssistantMessage>;
  /**
   * The offered models of every registered provider, in registration order. Each provider's list
   * is read live (its `refreshModels`) and is fresh for 30 minutes; after that it is returned at
   * once and read again in the background. A failed refresh keeps the last good list, or the
   * installed catalogue or definitions when no live list has been read, and says why in
   * `refreshError`; one failing provider never hides the others.
   */
  listModels(options?: ChatListModelsOptions): Promise<ChatProviderModels[]>;
}

/** pi-ai's event stream, whose final message carries the chat kit's record. */
export interface ChatTurnStream extends AssistantMessageEventStream {
  result(): Promise<ChatAssistantMessage>;
}

/**
 * pi-ai's final `AssistantMessage` with the chat kit's record of the turn under `chatKit`:
 * `chatKit.error` is present exactly when `stopReason` is `"error"`. An abort is
 * `stopReason: "aborted"`, without an error. `errorMessage` starts with `[provider/model]`, and
 * `rawStopReason` is the provider's own stop or block reason.
 */
export type ChatAssistantMessage = AssistantMessage &
  (
    | { stopReason: "error"; chatKit: { usage?: ChatUsage; error: ChatTurnError } }
    | { stopReason: Exclude<StopReason, "error">; chatKit: { usage?: ChatUsage; error?: undefined } }
  );

/**
 * - `CONTENT_BLOCKED`: a provider safety system blocked the prompt or the answer (`rawStopReason` is the provider's own value). Sent.
 * - `PROVIDER_ERROR`: the provider failed, or a response-schema answer could not be complete (it hit `maxTokens`, or Anthropic answered without the schema tool call). Sent.
 * - `UNSUPPORTED`: the provider or model cannot take the turn's documents, images, tools, schema or settings. Nothing was sent.
 * - `UNKNOWN_MODEL`: no provider has that id, or the model is not offered. Nothing was sent.
 * - `INVALID_REQUEST`: malformed input, a response schema together with tools (or with tool calls or tool results in the conversation), or a document whose `load()` failed. Nothing was sent.
 *
 * A new code may come in a minor release: treat an unknown code as `PROVIDER_ERROR`.
 */
export type ChatTurnErrorCode = "CONTENT_BLOCKED" | "PROVIDER_ERROR" | "UNSUPPORTED" | "UNKNOWN_MODEL" | "INVALID_REQUEST";

/** The chat kit's account of a failed turn, on the final message as `chatKit.error`. */
export interface ChatTurnError {
  code: ChatTurnErrorCode;
  /** HTTP status of the provider's error response, when there was one. */
  status?: number;
}

/**
 * A turn's Usage record (ADR 0005), with pi-ai's count names. A count is present only when the
 * provider reported it, never estimated or set to zero: unlike pi-ai's `Usage` on the message. A
 * turn has a record whenever the provider reported a token count or a cost or credit, which
 * `raw` keeps even when a count is missing.
 */
export interface ChatUsage {
  /**
   * The prompt tokens not read from or written to the cache: the reported prompt count minus the
   * reported cache counts, left out when negative. The whole prompt is `input + cacheRead + cacheWrite`.
   * On Gemini the prompt includes the tool-use prompt tokens of grounding (`toolUsePromptTokenCount`).
   */
  input?: number;
  /** Every generated token, reasoning included. Gemini leaves zero-valued counters out of its JSON, so a blocked prompt there has none. */
  output?: number;
  /** Prompt tokens read from the provider's prompt cache. */
  cacheRead?: number;
  /** Prompt tokens written to the provider's prompt cache. Gemini never reports them. */
  cacheWrite?: number;
  /** Reasoning tokens, part of `output`. */
  reasoning?: number;
  /** The provider's own total (Gemini, OpenAI APIs). Never computed, so never on Anthropic Messages, which reports none. */
  totalTokens?: number;
  /**
   * The turn's cost in USD, from the first source that applies (see `costSource`): the provider's
   * own charge, else an estimate from the model's rate in force when the turn started. Absent,
   * with `costSource`, when neither applies: never 0 for an unknown cost.
   */
  costUsd?: number;
  /**
   * - `provider`: the charge the provider reported for the turn;
   * - `estimated`: the model's rate in force when the turn started applied to the reported counts
   *   (pi-ai's `calculateCost`); a count the provider did not report adds nothing.
   */
  costSource?: "provider" | "estimated";
  /**
   * The provider's own usage record, under its own field names: `{ usageMetadata }` on Gemini,
   * otherwise `{ usage }` when it sent a usage object, plus any cost or credit field reported in or
   * next to it (for example OpenRouter `usage.cost`, KIE `credits_consumed`).
   */
  raw: Record<string, unknown>;
}

/** A pi-ai `Model` with what the chat kit adds under `chatKit`. It is also a `ChatModelRef`. */
export type ChatModel = Model<Api> & { chatKit: ChatModelTraits };

/** What the chat kit adds to a listed pi-ai `Model`, under `chatKit`. */
export interface ChatModelTraits {
  /** The model reads PDFs natively (pi-ai's `input` has only text and image). */
  fileInput: boolean;
  /**
   * A turn may send this model PDF and image documents: the provider takes them through the chat
   * kit, and the model reads both natively. The chat kit never sends a PDF to a paid parser. A turn
   * checks each document on its own, so a model that reads images but not PDFs still takes image
   * documents where the provider takes them. Plain-text documents work on every model.
   */
  fileDocuments: boolean;
  /** A turn may send this model `Context.tools`: the provider takes tools, and the model does. */
  tools: boolean;
  /**
   * A turn without `reasoning` may carry a response schema. With a reasoning level, a schema may
   * still be `UNSUPPORTED` (Anthropic Messages without native structured output).
   */
  responseSchema: boolean;
  /**
   * The model's dated rate schedule, in USD per 1M tokens. Absent when it has none, never a zero rate.
   * Read prices from here, not from `Model.cost`: that is the period in force when the provider was
   * created, and goes stale in a long-running process after a scheduled change.
   */
  rate?: ModelRate | undefined;
}

/** One registered provider's offered models, or why they could not be listed. */
export type ChatProviderModels =
  | {
      provider: ProviderId;
      /** `live`: the provider's own list (the last good one when a refresh failed); `installed`: no live list has been read yet. */
      source: "live" | "installed";
      /** When the live list was read (ISO 8601). */
      fetchedAt?: string;
      /** Why the latest refresh failed. The models are still the ones turns resolve against. */
      refreshError?: string;
      models: ChatModel[];
    }
  | { provider: ProviderId; error: string };

/** A reference document. Its bytes are loaded only when they have to be sent inline. */
export interface ChatDocument {
  /** File name, shown to the model. */
  name: string;
  /** `text/plain`, `text/markdown`, `text/csv`, `text/html`, `application/json`, `application/pdf`, `image/png`, `image/jpeg` or `image/webp`. */
  mimeType: string;
  /** Public or signed URL the provider may fetch the file from, instead of receiving its bytes. */
  url?: string | undefined;
  /** Size in bytes, when known. Gemini fetches a file by URL only when its size is known to be at most 15 MB. */
  size?: number | undefined;
  load(): Promise<Uint8Array>;
}

/** A JSON Schema the answer must follow. The answer then streams as JSON text. */
export interface ChatResponseSchema {
  /** 1–64 letters, digits, `_` or `-`. */
  name: string;
  schema: object;
}
