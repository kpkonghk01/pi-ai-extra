import type { Model } from "@earendil-works/pi-ai";
import { isRecord } from "@hk01/pi-ai-extra-internal";
import { getModelListJson, modelCostAt } from "@hk01/pi-ai-extra-internal/pi-ai";
import { GOOGLE_PROVIDER_ID } from "../constants.ts";
import { googleChatRate } from "./rates.ts";

type GoogleChatModel = Model<"google-generative-ai">;

/**
 * Ids of Gemini models that are not plain text chat models, though many list `generateContent`
 * and pi-ai's catalogue has some: embedding, Imagen, Veo and TTS models; Live API models
 * (`gemini-3.1-flash-live-preview`); computer use (`gemini-2.5-computer-use-preview-10-2025`);
 * image-output models, by `-image` (`gemini-3.1-flash-lite-image`, `gemini-3-pro-image-preview`)
 * or by their Nano Banana name (`nano-banana-pro-preview`, `gemini-nano-banana-2.1`); and the
 * Deep Research agents (`deep-research-preview-04-2026`). pi-ai 1.2's catalogues name no Gemini
 * image-output id these rules miss: its Google chat catalogue has one, `gemini-3.1-flash-lite-image`,
 * and every `google/*` id of its OpenRouter image catalogue is an `-image` id
 * (`gemini-2.5-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-image-preview`, …) or
 * `gemini-nano-banana-2.1`.
 */
const NOT_PLAIN_CHAT = /embedding|imagen|veo|tts|(?:^|-)live(?:-|$)|computer-use|(?:^|-)image(?:-|$)|nano-banana|deep-research/i;

/**
 * Moving aliases (`gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`): Google
 * can point one at another model at any time, which silently changes both its behaviour and its
 * price.
 */
const MOVING_ALIAS = /-latest$/i;

/**
 * Whether the chat kit offers a Gemini model id: a plain text chat model under its own id, not a
 * moving alias. The live list keeps every chat model it reads, for plain pi-ai use; the chat kit
 * offers only these (`chatKit.offers`).
 */
export function isOfferedGeminiId(id: string): boolean {
  return !NOT_PLAIN_CHAT.test(id) && !MOVING_ALIAS.test(id);
}

/** `models.list` pages; a key sees well under this many models. They share the list read's signal. */
const MAX_PAGES = 10;

/** A new Gemini model, unknown to pi-ai's catalogue: limits it does not report are kept small. */
const UNKNOWN_CONTEXT_WINDOW = 32_768;
const UNKNOWN_MAX_OUTPUT_TOKENS = 8_192;

/**
 * Gemini's live chat list: the ids `GET <base>/models` lists for the key (`x-goog-api-key`), with
 * the `models/` prefix stripped, kept when the model supports `generateContent`. A model in
 * `installed` (pi-ai's catalogue, with the rate table's cost) keeps that entry (thinking levels,
 * limits). A new id gets conservative defaults: text input only, the limits Gemini reports (else
 * small ones), no thinking levels, and its cost from the Gemini rate table, which usually means no
 * rate. `keep` narrows the list (the factory's `modelIds`). A list without a chat model throws.
 */
export async function fetchGeminiModels(input: {
  fetch: typeof globalThis.fetch;
  apiKey: string;
  baseUrl: string;
  installed: readonly GoogleChatModel[];
  keep: (id: string) => boolean;
  signal: AbortSignal;
}): Promise<GoogleChatModel[]> {
  const installed = new Map(input.installed.map((model) => [model.id, model]));
  const models: GoogleChatModel[] = [];
  const now = Date.now();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const body = await getModelListJson(input.fetch, `${input.baseUrl}/models?${query}`, { "x-goog-api-key": input.apiKey }, input.signal);
    if (!isRecord(body) || (body.models !== undefined && !Array.isArray(body.models))) throw new Error("the Gemini model list has no models array");
    for (const entry of (body.models ?? []) as unknown[]) {
      const model = geminiModel(entry, installed, input.baseUrl, now);
      if (model !== undefined && input.keep(model.id) && !models.some((listed) => listed.id === model.id)) models.push(model);
    }
    pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
    if (pageToken === undefined) break;
  }
  if (models.length === 0) throw new Error("the Gemini model list lists no chat model");
  return models;
}

function geminiModel(entry: unknown, installed: ReadonlyMap<string, GoogleChatModel>, baseUrl: string, now: number): GoogleChatModel | undefined {
  if (!isRecord(entry) || typeof entry.name !== "string") return undefined;
  const id = entry.name.replace(/^models\//, "");
  const methods = Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods : [];
  if (!id || !methods.includes("generateContent")) return undefined;
  const known = installed.get(id);
  if (known !== undefined) return known;
  return {
    id,
    name: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : id,
    api: "google-generative-ai",
    provider: GOOGLE_PROVIDER_ID,
    baseUrl,
    reasoning: entry.thinking === true,
    input: ["text"],
    cost: modelCostAt(googleChatRate(id), now),
    contextWindow: positiveInteger(entry.inputTokenLimit) ?? UNKNOWN_CONTEXT_WINDOW,
    maxTokens: positiveInteger(entry.outputTokenLimit) ?? UNKNOWN_MAX_OUTPUT_TOKENS,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
