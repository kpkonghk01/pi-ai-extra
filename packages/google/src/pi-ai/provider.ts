import { createProvider, type Model } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { withoutTrailingSlash } from "@hk01/pi-ai-extra-internal";
import { explicitApiKeyAuth, helperImages, modelCostAt, withLiveChatModels, type ChatProvider } from "@hk01/pi-ai-extra-internal/pi-ai";
import { GOOGLE_BASE_URL, GOOGLE_IMAGES_API, GOOGLE_PROVIDER_ID, GOOGLE_PROVIDER_NAME } from "../constants.ts";
import { generateGoogleImage, type GoogleImageRequest, type GoogleImageSettings } from "../generate.ts";
import { GOOGLE_IMAGE_MODELS } from "../models.ts";
import { fetchGeminiModels, isOfferedGeminiId } from "./live-models.ts";
import { googleChatRate, tableRate } from "./rates.ts";
import { googleChatStreams } from "./streams.ts";

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
  /** Ground chat answers with Google Search and URL context: both tools go on every chat request. Default `false`. */
  grounding?: boolean | undefined;
  /**
   * Custom fetch for the live model list (`refreshModels`), for tests or instrumentation. pi-ai's
   * Gemini adapter rejects a custom fetch, so chat requests always use the global one.
   */
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * pi-ai provider for Gemini chat: pi-ai's own Gemini adapter and model catalogue
 * (capabilities unchanged), authenticated only with the explicit `apiKey` — unlike pi-ai's
 * `googleProvider()`, it never reads `GEMINI_API_KEY`. A model in `GEMINI_CHAT_RATES` gets its
 * `cost` from the period in force when the provider is created; every other model keeps pi-ai's
 * list price.
 *
 * It is a chat provider (ADR 0009):
 *
 * - `refreshModels` reads the key's live list (`GET <baseUrl>/models`) and replaces the chat
 *   models with it (`fetchGeminiModels`), narrowed to `modelIds` when set.
 * - `grounding` adds Google Search and URL context to every chat request, and a prompt Gemini
 *   blocks ends with its `promptFeedback.blockReason` as `rawStopReason` (`googleChatStreams`).
 * - `chatKit`: Gemini takes PDF and image documents and tools; the chat kit offers its plain
 *   text chat models (`isOfferedGeminiId`). A model reads PDFs when it reads images, takes tools
 *   when it is a `gemini-*` model (not Gemma), and is priced from the Gemini rate table, else
 *   pi-ai's list price. Gemini reports no charge, so every turn is estimated.
 *
 * It also serves `GOOGLE_IMAGE_MODELS` (`models.getModelOfType("image", "google", id)`),
 * generated through `generateGoogleImage`. Image options go in `ImagesOptions.metadata`
 * (for example `{ aspectRatio: "16:9", resolution: "2K" }`); pi-ai has no image system
 * prompt or temperature, so `temperature` and `systemInstruction` go there too.
 */
export function createGoogleProvider(options: GoogleProviderOptions): ChatProvider<"google-generative-ai"> {
  const baseUrl = options.baseUrl === undefined ? undefined : withoutTrailingSlash(options.baseUrl);
  const now = Date.now();
  const images = helperImages({
    provider: GOOGLE_PROVIDER_ID,
    api: GOOGLE_IMAGES_API,
    baseUrl: options.imageSettings?.baseUrl ?? GOOGLE_BASE_URL,
    apiKey: options.apiKey,
    models: GOOGLE_IMAGE_MODELS,
    settings: options.imageSettings,
    generate: (request) => generateGoogleImage(request as unknown as GoogleImageRequest),
  });
  const installed = selectModels(options.modelIds).map((model) => withTableCost(baseUrl ? { ...model, baseUrl } : model, now));
  const base = createProvider<"google-generative-ai">({
    id: GOOGLE_PROVIDER_ID,
    name: GOOGLE_PROVIDER_NAME,
    baseUrl: baseUrl ?? GOOGLE_BASE_URL,
    auth: explicitApiKeyAuth(GOOGLE_PROVIDER_NAME, options.apiKey),
    models: [...installed, ...images.models],
    api: googleChatStreams(googleGenerativeAIApi(), options.grounding === true),
    images: images.images,
  });
  const provider = withLiveChatModels(base, (signal) =>
    fetchGeminiModels({
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      apiKey: options.apiKey,
      baseUrl: baseUrl ?? GOOGLE_BASE_URL,
      installed,
      keep: (id) => options.modelIds === undefined || options.modelIds.includes(id),
      signal,
    }),
  );
  return {
    ...provider,
    chatKit: {
      takes: { fileDocuments: true, tools: true, nativeStructuredOutput: false },
      offers: (model) => (model.type ?? "chat") === "chat" && isOfferedGeminiId(model.id),
      describe: (model) => {
        const rate = googleChatRate(model.id);
        return { fileInput: model.input.includes("image"), tools: model.id.startsWith("gemini-"), ...(rate === undefined ? {} : { rate }) };
      },
      reportedCostUsd: () => undefined,
      estimatesCost: true,
      fetch: options.fetch,
    },
  };
}

function selectModels(modelIds: readonly string[] | undefined): readonly GoogleChatModel[] {
  if (modelIds === undefined) return CATALOGUE;
  const unknown = modelIds.filter((id) => !GOOGLE_CHAT_MODEL_IDS.includes(id));
  if (unknown.length > 0) {
    throw new TypeError(`${GOOGLE_PROVIDER_NAME}: unknown chat model id(s) ${unknown.join(", ")}. Known: ${GOOGLE_CHAT_MODEL_IDS.join(", ")}.`);
  }
  return CATALOGUE.filter((model) => modelIds.includes(model.id));
}

/** The catalogue entry with `cost` from the Gemini rate table, when the table lists it. */
function withTableCost(model: GoogleChatModel, at: number): GoogleChatModel {
  const rate = tableRate(model.id);
  return rate === undefined ? model : { ...model, cost: modelCostAt(rate, at) };
}
