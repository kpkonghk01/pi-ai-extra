import type { ModelCost, Provider } from "@earendil-works/pi-ai";
import { withoutTrailingSlash } from "@hk01/pi-ai-extra-internal";
import { createChatProvider, helperImages, type ChatModelDefinition, type ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";
import { TOAPIS_BASE_URL, TOAPIS_IMAGES_API, TOAPIS_PROVIDER_ID, TOAPIS_PROVIDER_NAME, toapisResponsesBaseUrl } from "../constants.ts";
import { generateToapisImage, type ToapisImageRequest, type ToapisImageSettings } from "../generate.ts";
import { TOAPIS_IMAGE_MODELS } from "../models.ts";

export type { ChatModelDefinition, ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * USD per 1M tokens from a ToAPIs pricing entry: input = 2 × `model_ratio`, output =
 * 2 × `model_ratio` × `completion_ratio` (every group ratio is 1). ToAPIs publishes no cache
 * rates: `cacheRead` and `cacheWrite` are set to the input rate as a conservative upper bound.
 */
function ratioCost(modelRatio: number, completionRatio: number): ModelCost {
  const input = Math.round(2 * modelRatio * 1e6) / 1e6;
  const output = Math.round(2 * modelRatio * completionRatio * 1e6) / 1e6;
  return { input, output, cacheRead: input, cacheWrite: input };
}

/**
 * Chat models documented by ToAPIs: Codex (OpenAI Responses) and Claude (Anthropic Messages),
 * with the ids of its public model catalogue.
 *
 * Rates as of 2026-10-16, source: `GET https://toapis.com/api/pricing` (`model_ratio`,
 * `completion_ratio`).
 */
export const TOAPIS_CHAT_MODELS: readonly ChatModelDefinition[] = [
  // gpt-5.3-codex and gpt-5.3-codex-spark are listed as chat models but have no published rate
  // (absent from the pricing API): cost stays 0 until DATA-4568 can express "no rate".
  { id: "gpt-5.3-codex", protocol: "openai-responses" },
  { id: "gpt-5.3-codex-spark", protocol: "openai-responses" },
  { id: "gpt-5.3-codex-official", protocol: "openai-responses", cost: ratioCost(0.7, 8) },
  { id: "claude-opus-4-6", protocol: "anthropic-messages", cost: ratioCost(0.75, 5) },
  { id: "claude-sonnet-4-6", protocol: "anthropic-messages", cost: ratioCost(0.45, 5) },
  { id: "claude-haiku-4-5", protocol: "anthropic-messages", cost: ratioCost(0.15, 5) },
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
