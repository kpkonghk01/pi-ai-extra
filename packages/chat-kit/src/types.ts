import type { ThinkingLevel } from "@earendil-works/pi-ai";

/**
 * The providers the kit can run a turn on. This is the only list of them: `ChatProviderKind`, the
 * config validation and the registry's per-provider table all derive from it.
 */
export const PROVIDER_KINDS = ["google", "openrouter", "kie", "toapis"] as const;

/** The providers the kit can run a turn on. */
export type ChatProviderKind = (typeof PROVIDER_KINDS)[number];

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
  | {
      type: "done";
      /**
       * The usage the provider reported for the turn. Absent when it reported no token count and
       * no cost or credit: the kit never fills in zero counts (ADR 0005).
       */
      usage?: ChatUsage;
      /**
       * Present only when a free-form answer stopped at the output-token limit: the text already
       * streamed is the whole answer, cut off. A response-schema turn fails there instead.
       */
      truncated?: true;
    }
  | {
      type: "failed";
      error: ChatTurnError;
      /**
       * The usage the provider reported before the turn failed (Gemini bills blocked prompts).
       * Absent when it reported none, including every failure found before anything was sent.
       */
      usage?: ChatUsage;
    };

/**
 * - `CONTENT_BLOCKED`: a provider safety system blocked the prompt or the answer (`reason` is the provider's own value).
 * - `PROVIDER_ERROR`: the provider failed, or the answer stopped early (for example a response-schema answer at the output-token limit, or Gemini `RECITATION`).
 * - `UNSUPPORTED`: the selected provider or model cannot take this request (documents, schema, settings). Nothing was sent.
 * - `UNKNOWN_MODEL`: the provider name is not configured, or the model is not in its catalogue. Nothing was sent.
 * - `INVALID_REQUEST`: the turn input is malformed, or a document could not be loaded. Nothing was sent.
 * - `ABORTED`: the caller's signal aborted the turn.
 */
export type ChatTurnErrorCode = "CONTENT_BLOCKED" | "PROVIDER_ERROR" | "UNSUPPORTED" | "UNKNOWN_MODEL" | "INVALID_REQUEST" | "ABORTED";

export interface ChatTurnError {
  code: ChatTurnErrorCode;
  /**
   * The turn's `provider`: the consumer's provider name (for example `gemini`), not the provider
   * kind. `?` only when the input named none.
   */
  provider: string;
  /** The turn's `model`, the provider's own model id. `?` only when the input named none. */
  model: string;
  /** Starts with `[provider/model]`, from the two fields above. */
  message: string;
  /** The provider's raw stop or block reason, for example `SAFETY`, `content_filter`, `refusal` or `MAX_TOKENS`. */
  reason?: string;
  /** HTTP status of the provider's error response, when there was one. */
  status?: number;
}

/**
 * Usage as the provider reported it (the glossary's Usage record, ADR 0005). Every count is
 * optional: one the provider did not report is absent, never estimated or set to zero. A turn has
 * `usage` whenever the provider reported a token count or a cost or credit, which `raw` keeps even
 * when a count is missing; only a turn with neither has none. The cost fields are the one
 * addition: the provider's own charge, or the kit's estimate from the model's rate (ADR 0008).
 */
export interface ChatUsage {
  /**
   * Every prompt token, when the provider reported a prompt count: cached and cache-write tokens
   * included, and on Gemini the tool-use prompt tokens of grounding (`toolUsePromptTokenCount`).
   */
  inputTokens?: number;
  /**
   * Every generated token, reasoning included, when the provider reported an answer count. Gemini
   * leaves zero-valued counters out of its JSON, so a blocked prompt there has none.
   */
  outputTokens?: number;
  /** Prompt tokens read from the provider's prompt cache (part of `inputTokens`), when the provider reports them. */
  cachedInputTokens?: number;
  /** Prompt tokens written to the provider's prompt cache (part of `inputTokens`), when the provider reports them. Gemini never does. */
  cacheWriteTokens?: number;
  /** Reasoning tokens (part of `outputTokens`), when the provider reports them. */
  reasoningTokens?: number;
  /** The provider's own total, when it reports one (Gemini, OpenAI APIs). Never computed, so never on Anthropic, which reports none. */
  totalTokens?: number;
  /**
   * The turn's cost in USD, from the first source that applies (see `costSource`): the provider's
   * own charge, else an estimate from the model's rate in force when the turn started. Absent,
   * with `costSource`, when neither applies (no rate, or no counts to price): never 0 for an
   * unknown cost.
   */
  costUsd?: number;
  /**
   * - `provider`: the provider reported the charge: OpenRouter `usage.cost`, or KIE
   *   `credits_consumed` × $0.005 (KIE's cost always comes from its credits, because its token
   *   counts are unreliable).
   * - `estimated`: the kit applied the model's rate in force at call time to the reported counts:
   *   the large-prompt tier by `inputTokens`, cached and cache-write tokens at their rates (an
   *   unpublished cache rate is derived: reads at the input rate, writes at 1.25 × input), the
   *   rest of the prompt at the input rate, and `outputTokens`, reasoning included, at the output
   *   rate. A count the provider did not report adds nothing.
   */
  costSource?: "provider" | "estimated";
  /**
   * The provider's own usage record, under its own field names: `{ usageMetadata }` on Gemini, otherwise
   * `{ usage }` when it sent a usage object, plus any cost or credit field reported in or next to it (for
   * example OpenRouter `usage.cost`, KIE `credits_consumed`).
   */
  raw: Record<string, unknown>;
}
