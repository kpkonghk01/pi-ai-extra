import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ModelRate } from "./rates.ts";

/**
 * What the chat kit needs to know about a provider that pi-ai's `Provider` has no field for
 * (ADR 0009). Each provider package's factory sets it; plain pi-ai code ignores it.
 */
export interface ChatProviderTraits {
  /** Provider level: what the provider takes through the chat kit. Each is off until documented or verified live. */
  readonly takes: {
    /** PDF and image documents, through each wire API's native file input. Plain-text documents work on every provider. */
    readonly fileDocuments: boolean;
    /** `Context.tools`, with their tool calls and tool results. */
    readonly tools: boolean;
    /** Anthropic Messages native structured output (`output_config.format`), so a response schema works while the model thinks. */
    readonly nativeStructuredOutput: boolean;
  };
  /** Whether the chat kit offers this model: ADR 0008's exclusions (image output, routers, moving aliases, …). */
  offers(model: Model<Api>): boolean;
  /**
   * Model level: what the model itself can do. `fileInput`: it reads PDFs natively (pi-ai's `input`
   * has only text and image). `tools`: it takes tool definitions. `rate`: its dated rate schedule,
   * absent when it has none (never a zero rate).
   */
  describe(model: Model<Api>): { fileInput: boolean; tools: boolean; rate?: ModelRate | undefined };
  /** The provider's own charge for a turn, in USD, read from the turn's raw usage record; undefined when it reported none. */
  reportedCostUsd(raw: Record<string, unknown>): number | undefined;
  /** Whether a turn without a reported charge is estimated from the model's rate. */
  readonly estimatesCost: boolean;
  /**
   * The fetch the factory was given (its `fetch` option). The chat kit sends a turn through it, with
   * its own status-recording wrapper around it, unless the kit has a `fetch` of its own.
   */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/** A pi-ai `Provider` with the chat kit's traits under `chatKit`: what each provider package's factory returns. */
export type ChatProvider<TApi extends Api = Api> = Provider<TApi> & { readonly chatKit: ChatProviderTraits };
