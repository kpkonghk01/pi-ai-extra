import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { withoutTrailingSlash } from "@hk01/pi-ai-extra-internal";
import { explicitApiKeyAuth, helperImages } from "@hk01/pi-ai-extra-internal/pi-ai";
import { GOOGLE_BASE_URL, GOOGLE_IMAGES_API, GOOGLE_PROVIDER_ID, GOOGLE_PROVIDER_NAME } from "../constants.ts";
import { generateGoogleImage, type GoogleImageRequest, type GoogleImageSettings } from "../generate.ts";
import { GOOGLE_IMAGE_MODELS } from "../models.ts";

type GoogleChatModel = Model<"google-generative-ai">;

const CATALOGUE: readonly GoogleChatModel[] = Object.values(GOOGLE_MODELS) as GoogleChatModel[];

/** Gemini chat model ids from pi-ai's built-in catalogue (the default model list). */
export const GOOGLE_CHAT_MODEL_IDS: readonly string[] = CATALOGUE.map((model) => model.id);

export interface GoogleProviderOptions {
  /** Gemini API key from server-side secret configuration; used for chat and images. */
  apiKey: string;
  /**
   * Restrict the chat models to these catalogue ids. Unknown ids throw; nothing is silently
   * skipped. The image models are always `GOOGLE_IMAGE_MODELS`.
   */
  modelIds?: readonly string[] | undefined;
  /** Chat base URL. Default `https://generativelanguage.googleapis.com/v1beta`. */
  baseUrl?: string | undefined;
  /**
   * Image helper settings (`baseUrl`, `headers`) applied to every image request. The image
   * endpoint is set here, independently of the chat `baseUrl`.
   */
  imageSettings?: GoogleImageSettings | undefined;
}

/**
 * pi-ai provider for Gemini chat: pi-ai's own Gemini adapter and model catalogue
 * (capabilities and Google list prices unchanged), authenticated only with the
 * explicit `apiKey` — unlike pi-ai's `googleProvider()`, it never reads `GEMINI_API_KEY`.
 *
 * It also serves `GOOGLE_IMAGE_MODELS` (`models.getModelOfType("image", "google", id)`),
 * generated through `generateGoogleImage`. Image options go in `ImagesOptions.metadata`
 * (for example `{ aspectRatio: "16:9", resolution: "2K" }`); pi-ai has no image system
 * prompt or temperature, so `temperature` and `systemInstruction` go there too.
 */
export function createGoogleProvider(options: GoogleProviderOptions): Provider<"google-generative-ai"> {
  const baseUrl = options.baseUrl === undefined ? undefined : withoutTrailingSlash(options.baseUrl);
  const images = helperImages({
    provider: GOOGLE_PROVIDER_ID,
    api: GOOGLE_IMAGES_API,
    baseUrl: options.imageSettings?.baseUrl ?? GOOGLE_BASE_URL,
    apiKey: options.apiKey,
    models: GOOGLE_IMAGE_MODELS,
    settings: options.imageSettings,
    generate: (request) => generateGoogleImage(request as unknown as GoogleImageRequest),
  });
  return createProvider<"google-generative-ai">({
    id: GOOGLE_PROVIDER_ID,
    name: GOOGLE_PROVIDER_NAME,
    baseUrl: baseUrl ?? GOOGLE_BASE_URL,
    auth: explicitApiKeyAuth(GOOGLE_PROVIDER_NAME, options.apiKey),
    models: [...selectModels(options.modelIds).map((model) => (baseUrl ? { ...model, baseUrl } : model)), ...images.models],
    api: googleGenerativeAIApi(),
    images: images.images,
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
