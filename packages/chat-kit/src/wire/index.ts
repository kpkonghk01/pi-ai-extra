import { ANTHROPIC_MESSAGES_WIRE_API } from "./anthropic-messages.ts";
import { GOOGLE_WIRE_API } from "./google.ts";
import { OPENAI_COMPLETIONS_WIRE_API } from "./openai-completions.ts";
import { OPENAI_RESPONSES_WIRE_API } from "./openai-responses.ts";
import type { WireApi } from "./types.ts";

export type { BlockedTurn, PayloadPlan, SchemaRequest, StreamObserver, WireApi } from "./types.ts";

/** The pi-ai wire APIs the kit's providers use: Gemini, OpenRouter (two APIs), KIE and ToAPIs (two APIs). */
const WIRE_APIS: ReadonlyMap<string, WireApi> = new Map(
  [GOOGLE_WIRE_API, OPENAI_COMPLETIONS_WIRE_API, ANTHROPIC_MESSAGES_WIRE_API, OPENAI_RESPONSES_WIRE_API].map((wire) => [wire.api, wire]),
);

export function wireApiFor(api: string): WireApi | undefined {
  return WIRE_APIS.get(api);
}
