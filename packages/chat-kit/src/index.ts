/**
 * Server-only chat kit: runs one chat turn on the provider and model the consumer chose, with the
 * same features on every provider (reference documents, a response schema, safety-block
 * reporting, usage). It never chooses a provider and never falls back (ADR 0003, ADR 0008).
 *
 * Never import it from browser code: provider keys are passed to `createChatKit`.
 */
export { createChatKit } from "./kit.ts";
export type {
  ChatDocument,
  ChatHistoryMessage,
  ChatKit,
  ChatKitOptions,
  ChatProviderConfig,
  ChatProviderKind,
  ChatResponseSchema,
  ChatTurnError,
  ChatTurnErrorCode,
  ChatTurnEvent,
  ChatTurnInput,
  ChatTurnOptions,
  ChatTurnSettings,
  ChatUsage,
} from "./types.ts";
