import { getModelListJson, modelIdsOf, sameModelId } from "./http.ts";
import type { ListedModel } from "./list.ts";

/**
 * KIE's live chat list: the ids its two model lists name, kept only when a package definition
 * has them (the kit can price and run only those). KIE does not document the list's shape, so it
 * is read as an OpenAI-style `{ data: [{ id }] }` list; ids match across `.` and `-` spellings.
 *
 * - Codex (OpenAI Responses): `GET <host>/openai/v1/models`, which KIE's GPT pages name.
 * - Claude (Anthropic Messages): `GET <host>/anthropic/v1/models`, which KIE's Claude pages name.
 */
export async function fetchKieModels(input: {
  fetch: typeof globalThis.fetch;
  apiKey: string;
  host: string;
  installed: readonly ListedModel[];
  signal: AbortSignal;
}): Promise<ListedModel[]> {
  const auth = { authorization: `Bearer ${input.apiKey}` };
  const read = async (path: string) =>
    new Set(modelIdsOf(await getModelListJson(input.fetch, `${input.host}${path}`, auth, input.signal), `KIE ${path}`).map(sameModelId));
  const [codex, claude] = await Promise.all([read("/openai/v1/models"), read("/anthropic/v1/models")]);
  return keepListed(input.installed, (listed) => (listed.model.api === "anthropic-messages" ? claude : codex), "KIE");
}

/**
 * ToAPIs' live chat list: `GET <host>/v1/models?type=text` (documented, OpenAI-compatible
 * `{ data: [{ id }] }`), kept only when a package definition has the id.
 */
export async function fetchToapisModels(input: {
  fetch: typeof globalThis.fetch;
  apiKey: string;
  host: string;
  installed: readonly ListedModel[];
  signal: AbortSignal;
}): Promise<ListedModel[]> {
  const body = await getModelListJson(input.fetch, `${input.host}/v1/models?type=text`, { authorization: `Bearer ${input.apiKey}` }, input.signal);
  const ids = new Set(modelIdsOf(body, "ToAPIs /v1/models").map(sameModelId));
  return keepListed(input.installed, () => ids, "ToAPIs");
}

/**
 * The definitions the live lists name, in definition order. None at all is treated as a failed
 * refresh, not as an empty list: with an undocumented list shape it more likely means the ids
 * were not recognised, and the installed definitions stay in use.
 */
function keepListed(installed: readonly ListedModel[], listFor: (listed: ListedModel) => ReadonlySet<string>, provider: string): ListedModel[] {
  const kept = installed.filter((listed) => listFor(listed).has(sameModelId(listed.model.id)));
  if (kept.length === 0) throw new Error(`the ${provider} model lists name none of the package's chat models`);
  return kept;
}
