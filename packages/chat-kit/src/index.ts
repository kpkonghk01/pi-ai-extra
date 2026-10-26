/**
 * Server-only chat kit on pi-ai (ADR 0008, ADR 0009). It registers the chat providers a consumer
 * builds with the provider packages' factories, offers one interface for calling LLMs, and routes
 * each turn by its model reference (`{ provider, id }`) to that provider. A turn takes pi-ai's
 * `Context` and option names and streams pi-ai's events. Beside them it gives every provider the
 * same extras pi-ai lacks: reference documents, a response schema, safety-block reporting, and a
 * usage record with its cost. It never chooses a provider and never falls back (ADR 0003).
 *
 * Never import it from browser code: the providers it registers hold their keys.
 */
export { createChatKit } from "./kit.ts";
export type { ChatProvider, ChatProviderTraits, LargePromptRates, ModelRate, RatePeriod, TokenRates } from "@hk01/pi-ai-extra-internal/pi-ai";
export type {
  ChatAssistantMessage,
  ChatDocument,
  ChatKit,
  ChatKitOptions,
  ChatListModelsOptions,
  ChatModel,
  ChatModelRef,
  ChatModelTraits,
  ChatProviderModels,
  ChatResponseSchema,
  ChatSchemaStreamOptions,
  ChatStreamOptions,
  ChatToolFreeContext,
  ChatTurnError,
  ChatTurnErrorCode,
  ChatTurnStream,
  ChatUsage,
} from "./types.ts";
