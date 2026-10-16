import type { ThinkingLevel } from "@earendil-works/pi-ai";

/** The providers the kit can run a turn on. */
export type ChatProviderKind = "google" | "openrouter" | "kie" | "toapis";

/** One provider the consumer application offers, registered with its own explicit key. */
export interface ChatProviderConfig {
  /** Consumer-chosen name, used as `ChatTurnInput.provider` (for example `"gemini"` for `google`). */
  name: string;
  provider: ChatProviderKind;
  /** API key from server-side secret configuration. The kit never reads environment variables. */
  apiKey: string;
  /**
   * API root override: Gemini's chat base URL (`https://generativelanguage.googleapis.com/v1beta`),
   * OpenRouter's API root (`https://openrouter.ai/api`), the KIE host (`https://api.kie.ai`) or the
   * ToAPIs host (`https://toapis.com`).
   */
  baseUrl?: string | undefined;
  /** Google only: ground answers with Google Search and URL context. Default `false`. */
  grounding?: boolean | undefined;
}

export interface ChatKitOptions {
  providers: readonly ChatProviderConfig[];
  /**
   * Custom fetch for tests or instrumentation. Not applied to Gemini: pi-ai's Gemini adapter
   * rejects a custom fetch and always uses the global one.
   */
  fetch?: typeof globalThis.fetch | undefined;
}

export interface ChatTurnOptions {
  /** Cancels the turn. The turn then ends with a `failed` event whose code is `ABORTED`. */
  signal?: AbortSignal | undefined;
}

export interface ChatKit {
  /**
   * Runs one chat turn on exactly the provider and model in `input`. It never throws and never
   * falls back to another provider or model: every failure arrives as a `failed` event, which is
   * always the last event.
   */
  runTurn(input: ChatTurnInput, options?: ChatTurnOptions): AsyncIterable<ChatTurnEvent>;
}

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

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

/** A JSON Schema the answer must follow. The answer then streams as JSON text. */
export interface ChatResponseSchema {
  /** 1–64 letters, digits, `_` or `-`. */
  name: string;
  schema: object;
}

export interface ChatTurnSettings {
  temperature?: number | undefined;
  maxOutputTokens?: number | undefined;
  /** Thinking effort, clamped by pi-ai to what the model supports. Omitted: thinking off where the model allows it. */
  reasoning?: ThinkingLevel | undefined;
}

export interface ChatTurnInput {
  /** A `ChatProviderConfig.name`. */
  provider: string;
  /** The provider's own model id, which must be in the provider's pi-ai catalogue. */
  model: string;
  systemPrompt: string;
  documents: readonly ChatDocument[];
  history: readonly ChatHistoryMessage[];
  message: string;
  responseSchema?: ChatResponseSchema | undefined;
  settings?: ChatTurnSettings | undefined;
}

export type ChatTurnEvent =
  | { type: "text"; delta: string }
  | { type: "done"; usage: ChatUsage }
  | { type: "failed"; error: ChatTurnError; usage?: ChatUsage };

/**
 * - `CONTENT_BLOCKED`: a provider safety system blocked the prompt or the answer (`reason` is the provider's own value).
 * - `PROVIDER_ERROR`: the provider failed, or the answer was cut off (for example at the output token limit).
 * - `UNSUPPORTED`: the selected provider or model cannot take this request (documents, schema, settings). Nothing was sent.
 * - `UNKNOWN_MODEL`: the provider name is not configured, or the model is not in its catalogue. Nothing was sent.
 * - `INVALID_REQUEST`: the turn input is malformed, or a document could not be loaded. Nothing was sent.
 * - `ABORTED`: the caller's signal aborted the turn.
 */
export type ChatTurnErrorCode = "CONTENT_BLOCKED" | "PROVIDER_ERROR" | "UNSUPPORTED" | "UNKNOWN_MODEL" | "INVALID_REQUEST" | "ABORTED";

export interface ChatTurnError {
  code: ChatTurnErrorCode;
  /** Starts with `[provider/model]`, the consumer's provider name and the model id. */
  message: string;
  /** The provider's raw stop or block reason, for example `SAFETY`, `content_filter`, `refusal` or `MAX_TOKENS`. */
  reason?: string;
  /** HTTP status of the provider's error response, when there was one. */
  status?: number;
}

/** Token counts as the provider reported them. The kit computes no cost. */
export interface ChatUsage {
  /** Every prompt token, including cached and cache-write tokens. */
  inputTokens: number;
  /** Every generated token, including reasoning tokens. */
  outputTokens: number;
  /** Prompt tokens read from the provider's prompt cache (part of `inputTokens`). */
  cachedInputTokens: number;
  /** Prompt tokens written to the provider's prompt cache (part of `inputTokens`). */
  cacheWriteTokens: number;
  /** Reasoning tokens (part of `outputTokens`), when the provider reports them. */
  reasoningTokens?: number;
  totalTokens: number;
  /**
   * The provider's own usage record, under its own field names: `{ usageMetadata }` on Gemini, otherwise
   * `{ usage }`, plus any cost or credit field reported next to it (for example OpenRouter `usage.cost`,
   * KIE `credits_consumed`). Absent when the provider reported no usage.
   */
  raw?: unknown;
}
