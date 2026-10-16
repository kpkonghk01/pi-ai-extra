import type { Provider } from "@earendil-works/pi-ai";
import { withoutTrailingSlash } from "@hk01/pi-ai-extra-internal";
import { createChatProvider, helperImages, singleRate, type ChatModelDefinition, type ChatProtocol, type ModelRate } from "@hk01/pi-ai-extra-internal/pi-ai";
import { TOAPIS_BASE_URL, TOAPIS_IMAGES_API, TOAPIS_PROVIDER_ID, TOAPIS_PROVIDER_NAME, toapisResponsesBaseUrl } from "../constants.ts";
import { generateToapisImage, type ToapisImageRequest, type ToapisImageSettings } from "../generate.ts";
import { TOAPIS_IMAGE_MODELS } from "../models.ts";

export type { ChatModelDefinition, ChatProtocol, LargePromptRates, ModelRate, RatePeriod, TokenRates } from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * A one-period schedule in USD per 1M tokens from a ToAPIs pricing entry: input =
 * 2 × `model_ratio`, output = 2 × `model_ratio` × `completion_ratio` (every group ratio is 1).
 * ToAPIs publishes no dates and no cache rates; pricing derives the cache rates
 * (`toModelCost`).
 */
function ratioRate(modelRatio: number, completionRatio: number): ModelRate {
  const round = (usd: number) => Math.round(usd * 1e6) / 1e6;
  return singleRate({ input: round(2 * modelRatio), output: round(2 * modelRatio * completionRatio) });
}

/**
 * Chat models documented by ToAPIs: Codex (OpenAI Responses) and Claude (Anthropic Messages),
 * with the ids of its public model catalogue. Only models with a published rate are offered.
 *
 * Rates as of 2026-10-16, source: `GET https://toapis.com/api/pricing` (`model_ratio`,
 * `completion_ratio`).
 *
 * `gpt-5.3-codex` and `gpt-5.3-codex-spark` are left out: ToAPIs documents them as chat models,
 * but they have no published rate and are absent from its public model catalogue. A consumer
 * that wants them passes them in the factory's `models` option.
 */
export const TOAPIS_CHAT_MODELS: readonly ChatModelDefinition[] = [
  { id: "gpt-5.3-codex-official", protocol: "openai-responses", rate: ratioRate(0.7, 8) },
  { id: "claude-opus-4-6", protocol: "anthropic-messages", rate: ratioRate(0.75, 5) },
  { id: "claude-sonnet-4-6", protocol: "anthropic-messages", rate: ratioRate(0.45, 5) },
  { id: "claude-haiku-4-5", protocol: "anthropic-messages", rate: ratioRate(0.15, 5) },
];

export interface ToapisProviderOptions {
  /** ToAPIs API key from server-side secret configuration; used for chat and images. */
  apiKey: string;
  /** Replaces the default chat model list. The image models are always `TOAPIS_IMAGE_MODELS`. */
  models?: readonly ChatModelDefinition[] | undefined;
  /** Chat host. Default `https://toapis.com`; mainland China users may choose `https://toapis.cn` explicitly. */
  baseUrl?: string | undefined;
  /**
   * Image helper settings (`baseUrl`, `poll`, `clientBusinessId`) applied to every image request.
   * The image host is set here, independently of the chat `baseUrl`.
   */
  imageSettings?: ToapisImageSettings | undefined;
}

/**
 * pi-ai provider for ToAPIs. Codex models use pi-ai's OpenAI Responses adapter
 * (`<host>/v1/responses`); Claude models use its Anthropic Messages adapter (`<host>/v1/messages`).
 *
 * It also serves `TOAPIS_IMAGE_MODELS` (`models.getModelOfType("image", "toapis", id)`),
 * generated through `generateToapisImage`. Image options go in `ImagesOptions.metadata`
 * using the helper's option names and are validated strictly.
 */
export function createToapisProvider(options: ToapisProviderOptions): Provider<ChatProtocol> {
  const host = withoutTrailingSlash(options.baseUrl ?? TOAPIS_BASE_URL);
  return createChatProvider({
    id: TOAPIS_PROVIDER_ID,
    name: TOAPIS_PROVIDER_NAME,
    apiKey: options.apiKey,
    baseUrls: { "openai-responses": toapisResponsesBaseUrl(host), "anthropic-messages": host },
    models: options.models ?? TOAPIS_CHAT_MODELS,
    anthropicAuth: "x-api-key",
    images: helperImages({
      provider: TOAPIS_PROVIDER_ID,
      api: TOAPIS_IMAGES_API,
      baseUrl: options.imageSettings?.baseUrl ?? TOAPIS_BASE_URL,
      apiKey: options.apiKey,
      models: TOAPIS_IMAGE_MODELS,
      settings: options.imageSettings,
      generate: (request) => generateToapisImage(request as unknown as ToapisImageRequest),
    }),
  });
}
