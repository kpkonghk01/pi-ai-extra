import type { Model } from "@earendil-works/pi-ai";
import { modelIdKey } from "@hk01/pi-ai-extra-internal/model-id";
import { getModelListJson, keepListed, modelIdsOf, type ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * KIE's live chat list: the package's models (`installed`) whose ids KIE's two model lists name
 * (the provider can price and run only those). KIE does not document the lists' shape, so each is
 * read as an OpenAI-style `{ data: [{ id }] }` list; ids match across `.` and `-` spellings.
 *
 * - Codex (OpenAI Responses): `GET <responsesBaseUrl>/models` (`https://api.kie.ai/openai/v1/models`), which KIE's GPT pages name.
 * - Claude (Anthropic Messages): `GET <claudeBaseUrl>/v1/models` (`https://api.kie.ai/anthropic/v1/models`), which KIE's Claude pages name.
 */
export async function fetchKieModels(input: {
  fetch: typeof globalThis.fetch;
  apiKey: string;
  responsesBaseUrl: string;
  claudeBaseUrl: string;
  installed: readonly Model<ChatProtocol>[];
  signal: AbortSignal;
}): Promise<Model<ChatProtocol>[]> {
  const auth = { authorization: `Bearer ${input.apiKey}` };
  const read = async (url: string, source: string) =>
    new Set(modelIdsOf(await getModelListJson(input.fetch, url, auth, input.signal), source).map(modelIdKey));
  const [codex, claude] = await Promise.all([
    read(`${input.responsesBaseUrl}/models`, "KIE /openai/v1/models"),
    read(`${input.claudeBaseUrl}/v1/models`, "KIE /anthropic/v1/models"),
  ]);
  return keepListed(input.installed, (model) => (model.api === "anthropic-messages" ? claude : codex), "KIE");
}
