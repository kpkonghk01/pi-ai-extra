import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { DocumentPlacement, PreparedDocument } from "../documents.ts";
import type { ChatDocument, ChatResponseSchema, ChatTurnSettings, ChatUsage } from "../types.ts";

/** Everything a payload transform adds to the request pi-ai built. */
export interface PayloadPlan {
  /** The marker text part to replace with the documents; undefined when there are none. */
  marker: string | undefined;
  documents: readonly PreparedDocument[];
  responseSchema: ChatResponseSchema | undefined;
  /** Gemini only: add Google Search and URL context tools. */
  grounding: boolean;
  /**
   * The request goes to OpenRouter (`targetsOpenRouter()`), so Anthropic Messages pins its file
   * parser to `native` too. OpenAI Completions, which only OpenRouter speaks here, always does.
   */
  targetsOpenRouter: boolean;
  /**
   * Anthropic Messages only: send the response schema as native structured output
   * (`output_config.format`) instead of a forced tool call.
   */
  nativeStructuredOutput: boolean;
}

/** What decides how, and whether, a model takes a response schema. */
export interface SchemaRequest {
  responseSchema: ChatResponseSchema | undefined;
  settings: ChatTurnSettings;
  /**
   * Whether the provider accepts native structured output on this API: Anthropic Messages
   * `output_config.format`, which works while the model thinks.
   */
  nativeStructuredOutput: boolean;
}

/** A safety block found in a finished or failed turn. */
export interface BlockedTurn {
  /** The provider's raw reason, for example `SAFETY`, `content_filter` or `refusal`. */
  reason: string;
  /** Human-readable account, including the provider's explanation when it gave one. */
  message: string;
}

/** Per-turn state built from the provider's raw stream events (pi-ai `onProviderStreamEvent`). */
export interface StreamObserver {
  observe(event: unknown): void;
  /**
   * The usage the provider reported, read from its raw usage record (`ChatUsage.raw`) rather than
   * from pi-ai's `Usage`, which fills unreported counts with zero. Undefined when it reported none.
   */
  usage(): ChatUsage | undefined;
  blocked(message: AssistantMessage): BlockedTurn | undefined;
}

/**
 * What the kit does differently per pi-ai wire API. The gaps it fills (documents, response
 * schema, safety-block reporting, grounding) belong to the API, not to the provider, so one
 * implementation serves every provider that speaks the API.
 */
export interface WireApi {
  readonly api: Api;
  /** Whether pi-ai's adapter for this API accepts a custom fetch (its Gemini adapter rejects one). */
  readonly acceptsFetch: boolean;
  /** Whether the response schema goes as a forced tool call: its argument deltas are then the answer text. */
  schemaAsToolCall(model: Model<Api>, request: SchemaRequest): boolean;
  /** Whether a PDF or image is fetched by the provider from its URL or sent inline. */
  placeDocument(document: ChatDocument, model: Model<Api>): DocumentPlacement;
  /** Why this request cannot run on this model, checked before any document is loaded. */
  unsupported(model: Model<Api>, request: SchemaRequest): string | undefined;
  /** Pure transform of the payload pi-ai built; it must not mutate its input. */
  transform(payload: unknown, plan: PayloadPlan): unknown;
  createObserver(): StreamObserver;
}
