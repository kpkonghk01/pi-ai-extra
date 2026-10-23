import type { Model } from "@earendil-works/pi-ai";
import { modelIdKey } from "@hk01/pi-ai-extra-internal/model-id";
import { getModelListJson, keepListed, modelIdsOf, type ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * ToAPIs' live chat list: `GET <host>/v1/models?type=text` (documented, OpenAI-compatible
 * `{ data: [{ id }] }`), keeping the package's models (`installed`) whose ids it names.
 */
export async function fetchToapisModels(input: {
  fetch: typeof globalThis.fetch;
  apiKey: string;
  host: string;
  installed: readonly Model<ChatProtocol>[];
  signal: AbortSignal;
}): Promise<Model<ChatProtocol>[]> {
  const body = await getModelListJson(input.fetch, `${input.host}/v1/models?type=text`, { authorization: `Bearer ${input.apiKey}` }, input.signal);
  const ids = new Set(modelIdsOf(body, "ToAPIs /v1/models").map(modelIdKey));
  return keepListed(input.installed, () => ids, "ToAPIs");
}
