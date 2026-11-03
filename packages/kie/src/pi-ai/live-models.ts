import type { Model } from "@earendil-works/pi-ai";
import { modelIdKey } from "@hk01/pi-ai-extra-internal/model-id";
import { getModelListJson, keepListed, modelIdsOf, type ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * Which of KIE's two model lists names a model: Codex's (OpenAI Responses), Claude's (Anthropic
 * Messages), or none, for the Gemini models on Chat Completions (ADR 0010).
 */
function listOf(model: Model<ChatProtocol>): "codex" | "claude" | undefined {
  if (model.api === "openai-responses") return "codex";
  if (model.api === "anthropic-messages") return "claude";
  return undefined;
}

/**
 * KIE's live chat list: the package's models (`installed`) that a KIE list names, kept when it
 * names them (the provider can price and run only those), and every model no list names, kept as
 * installed. KIE does not document the lists' shape, so each is read as an OpenAI-style
 * `{ data: [{ id }] }` list; ids match across `.` and `-` spellings.
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
  const listed = input.installed.filter((model) => listOf(model) !== undefined);
  if (listed.length === 0) return [...input.installed];
  const auth = { authorization: `Bearer ${input.apiKey}` };
  const read = async (url: string, source: string) =>
    new Set(modelIdsOf(await getModelListJson(input.fetch, url, auth, input.signal), source).map(modelIdKey));
  const [codex, claude] = await Promise.all([
    read(`${input.responsesBaseUrl}/models`, "KIE /openai/v1/models"),
    read(`${input.claudeBaseUrl}/v1/models`, "KIE /anthropic/v1/models"),
  ]);
  const kept = new Set(keepListed(listed, (model) => (listOf(model) === "claude" ? claude : codex), "KIE"));
  return input.installed.filter((model) => listOf(model) === undefined || kept.has(model));
}
