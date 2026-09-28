import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { withoutTrailingSlash } from "@hk01/pi-ai-extra-internal";
import { explicitApiKeyAuth } from "@hk01/pi-ai-extra-internal/pi-ai";
import { GOOGLE_BASE_URL, GOOGLE_PROVIDER_ID, GOOGLE_PROVIDER_NAME } from "../constants.ts";

type GoogleChatModel = Model<"google-generative-ai">;

const CATALOGUE: readonly GoogleChatModel[] = Object.values(GOOGLE_MODELS) as GoogleChatModel[];

/** Gemini chat model ids from pi-ai's built-in catalogue (the default model list). */
export const GOOGLE_CHAT_MODEL_IDS: readonly string[] = CATALOGUE.map((model) => model.id);

export interface GoogleProviderOptions {
  /** Gemini API key from server-side secret configuration. */
  apiKey: string;
  /** Restrict the provider to these catalogue ids. Unknown ids throw; nothing is silently skipped. */
  modelIds?: readonly string[] | undefined;
  /** Default `https://generativelanguage.googleapis.com/v1beta`. */
  baseUrl?: string | undefined;
}

/**
 * pi-ai chat provider for Gemini: pi-ai's own Gemini adapter and model catalogue
 * (capabilities and Google list prices unchanged), authenticated only with the
 * explicit `apiKey` — unlike pi-ai's `googleProvider()`, it never reads `GEMINI_API_KEY`.
 */
export function createGoogleProvider(options: GoogleProviderOptions): Provider<"google-generative-ai"> {
  const baseUrl = options.baseUrl === undefined ? undefined : withoutTrailingSlash(options.baseUrl);
  return createProvider<"google-generative-ai">({
    id: GOOGLE_PROVIDER_ID,
    name: GOOGLE_PROVIDER_NAME,
    baseUrl: baseUrl ?? GOOGLE_BASE_URL,
    auth: explicitApiKeyAuth(GOOGLE_PROVIDER_NAME, options.apiKey),
    models: selectModels(options.modelIds).map((model) => (baseUrl ? { ...model, baseUrl } : model)),
    api: googleGenerativeAIApi(),
  });
}

function selectModels(modelIds: readonly string[] | undefined): readonly GoogleChatModel[] {
  if (modelIds === undefined) return CATALOGUE;
  const unknown = modelIds.filter((id) => !GOOGLE_CHAT_MODEL_IDS.includes(id));
  if (unknown.length > 0) {
    throw new TypeError(`${GOOGLE_PROVIDER_NAME}: unknown chat model id(s) ${unknown.join(", ")}. Known: ${GOOGLE_CHAT_MODEL_IDS.join(", ")}.`);
  }
  return CATALOGUE.filter((model) => modelIds.includes(model.id));
}
