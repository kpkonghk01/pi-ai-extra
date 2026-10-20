import type { Api, Model } from "@earendil-works/pi-ai";
import { googleChatRate } from "@hk01/pi-ai-extra-google/pi-ai";
import { modelCostAt } from "@hk01/pi-ai-extra-internal/rates";
import { isRecord } from "../guards.ts";
import { getModelListJson } from "./http.ts";
import type { ListedModel } from "./list.ts";

/**
 * Ids of Gemini models that are not plain text chat models, though many list `generateContent`
 * and pi-ai's catalogue has some: embedding, Imagen, Veo and TTS models; Live API models
 * (`gemini-3.1-flash-live-preview`); computer use (`gemini-2.5-computer-use-preview-10-2025`);
 * image-output models, by `-image` (`gemini-3.1-flash-lite-image`, `gemini-3-pro-image-preview`)
 * or by their Nano Banana name (`nano-banana-pro-preview`, `gemini-nano-banana-2.1`); and the
 * Deep Research agents (`deep-research-preview-04-2026`). pi-ai 1.2's catalogues name no other
 * Gemini image-output id: its Google chat catalogue has `gemini-3.1-flash-lite-image`, and its
 * OpenRouter image catalogue the `google/*` ones above.
 */
const NOT_PLAIN_CHAT = /embedding|imagen|veo|tts|(?:^|-)live(?:-|$)|computer-use|(?:^|-)image(?:-|$)|nano-banana|deep-research/i;

/**
 * Moving aliases (`gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`): Google
 * can point one at another model at any time, which silently changes both its behaviour and its
 * price.
 */
const MOVING_ALIAS = /-latest$/i;

/**
 * Whether a Gemini model id is offered: a plain text chat model under its own id, not a moving
 * alias. The live list and the installed catalogue both keep only these.
 */
export function isOfferedGeminiId(id: string): boolean {
  return !NOT_PLAIN_CHAT.test(id) && !MOVING_ALIAS.test(id);
}

/** `models.list` pages; a key sees well under this many models. They share the list read's deadline (`LIST_READ_TIMEOUT_MS`). */
const MAX_PAGES = 10;

/** A new Gemini model, unknown to pi-ai's catalogue: limits it does not report are kept small. */
const UNKNOWN_CONTEXT_WINDOW = 32_768;
const UNKNOWN_MAX_OUTPUT_TOKENS = 8_192;

/**
 * Gemini's live chat list: the ids `GET <base>/models` lists for the key (`x-goog-api-key`), with
 * the `models/` prefix stripped, kept when the model supports `generateContent` and is a plain
 * text chat model under its own id, not a `-latest` alias (`isOfferedGeminiId`). A model pi-ai's
 * catalogue knows keeps its catalogue entry (thinking levels, limits) and rate. A new id gets
 * conservative defaults: text input only, the limits Gemini reports (else small ones), no
 * thinking levels, and its rate from the Gemini rate table, which usually means no rate.
 */
export async function fetchGeminiModels(input: {
  fetch: typeof globalThis.fetch;
  apiKey: string;
  baseUrl: string;
  installed: readonly ListedModel[];
  signal: AbortSignal;
  now: number;
}): Promise<ListedModel[]> {
  const installed = new Map(input.installed.map((listed) => [listed.model.id, listed]));
  const models: ListedModel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const body = await getModelListJson(input.fetch, `${input.baseUrl}/models?${query}`, { "x-goog-api-key": input.apiKey }, input.signal);
    if (!isRecord(body) || (body.models !== undefined && !Array.isArray(body.models))) throw new Error("the Gemini model list has no models array");
    for (const entry of (body.models ?? []) as unknown[]) {
      const listed = geminiModel(entry, installed, input.baseUrl, input.now);
      if (listed !== undefined && !models.some((model) => model.model.id === listed.model.id)) models.push(listed);
    }
    pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
    if (pageToken === undefined) break;
  }
  if (models.length === 0) throw new Error("the Gemini model list lists no chat model");
  return models;
}

function geminiModel(entry: unknown, installed: ReadonlyMap<string, ListedModel>, baseUrl: string, now: number): ListedModel | undefined {
  if (!isRecord(entry) || typeof entry.name !== "string") return undefined;
  const id = entry.name.replace(/^models\//, "");
  const methods = Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods : [];
  if (!id || !methods.includes("generateContent") || !isOfferedGeminiId(id)) return undefined;
  const known = installed.get(id);
  if (known !== undefined) return known;
  const rate = googleChatRate(id);
  const model: Model<"google-generative-ai"> = {
    id,
    name: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : id,
    api: "google-generative-ai",
    provider: "google",
    baseUrl,
    reasoning: entry.thinking === true,
    input: ["text"],
    cost: modelCostAt(rate, now),
    contextWindow: positiveInteger(entry.inputTokenLimit) ?? UNKNOWN_CONTEXT_WINDOW,
    maxTokens: positiveInteger(entry.outputTokenLimit) ?? UNKNOWN_MAX_OUTPUT_TOKENS,
  };
  return { model: model as Model<Api>, rate, input: ["text"] };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
