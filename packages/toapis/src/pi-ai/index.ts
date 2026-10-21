import { withoutTrailingSlash } from "@hk01/pi-ai-extra-internal";
import {
  createChatProvider,
  helperImages,
  roundRate,
  singleRate,
  withLiveChatModels,
  type ChatModelDefinition,
  type ChatProtocol,
  type ChatProvider,
  type ModelRate,
} from "@hk01/pi-ai-extra-internal/pi-ai";
import { TOAPIS_BASE_URL, TOAPIS_IMAGES_API, TOAPIS_PROVIDER_ID, TOAPIS_PROVIDER_NAME, toapisResponsesBaseUrl } from "../constants.ts";
import { generateToapisImage, type ToapisImageRequest, type ToapisImageSettings } from "../generate.ts";
import { TOAPIS_IMAGE_MODELS } from "../models.ts";
import { fetchToapisModels } from "./live-models.ts";

export type {
  ChatModelDefinition,
  ChatProtocol,
  ChatProvider,
  ChatProviderTraits,
  LargePromptRates,
  ModelRate,
  RatePeriod,
  TokenRates,
} from "@hk01/pi-ai-extra-internal/pi-ai";

/**
 * A one-period schedule in USD per 1M tokens from a ToAPIs pricing entry: input =
 * 2 × `model_ratio`, output = 2 × `model_ratio` × `completion_ratio` (every group ratio is 1).
 * ToAPIs publishes no dates and no cache rates; pricing derives the cache rates
 * (`toModelCost`).
 */
function ratioRate(modelRatio: number, completionRatio: number): ModelRate {
  return singleRate({ input: roundRate(2 * modelRatio), output: roundRate(2 * modelRatio * completionRatio) });
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
  /** Custom fetch for chat requests and the live model list, for tests or instrumentation. A request's own `fetch` wins. */
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * pi-ai provider for ToAPIs. Codex models use pi-ai's OpenAI Responses adapter
 * (`<host>/v1/responses`); Claude models use its Anthropic Messages adapter (`<host>/v1/messages`).
 *
 * It is a chat provider (ADR 0009):
 *
 * - `refreshModels` reads `GET <host>/v1/models?type=text` and keeps the chat models it names
 *   (`fetchToapisModels`).
 * - `chatKit`: ToAPIs' file input, tools and native structured output are undocumented, so none
 *   is taken until a live smoke test. Every chat model is offered, reads PDFs when it reads
 *   images, and is priced from its definition's rate. ToAPIs reports no charge, so every turn is
 *   estimated.
 *
 * It also serves `TOAPIS_IMAGE_MODELS` (`models.getModelOfType("image", "toapis", id)`),
 * generated through `generateToapisImage`. Image options go in `ImagesOptions.metadata`
 * using the helper's option names and are validated strictly.
 */
export function createToapisProvider(options: ToapisProviderOptions): ChatProvider<ChatProtocol> {
  const host = withoutTrailingSlash(options.baseUrl ?? TOAPIS_BASE_URL);
  const definitions = options.models ?? TOAPIS_CHAT_MODELS;
  const base = createChatProvider({
    id: TOAPIS_PROVIDER_ID,
    name: TOAPIS_PROVIDER_NAME,
    apiKey: options.apiKey,
    baseUrls: { "openai-responses": toapisResponsesBaseUrl(host), "anthropic-messages": host },
    models: definitions,
    anthropicAuth: "x-api-key",
    fetch: options.fetch,
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
  const installed = base.getModels();
  const provider = withLiveChatModels(base, (signal) =>
    fetchToapisModels({
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      apiKey: options.apiKey,
      host,
      installed,
      signal,
    }),
  );
  return {
    ...provider,
    chatKit: {
      takes: { fileDocuments: false, tools: false, nativeStructuredOutput: false },
      offers: (model) => (model.type ?? "chat") === "chat",
      describe: (model) => {
        const rate = definitions.find((definition) => definition.id === model.id)?.rate;
        return { fileInput: model.input.includes("image"), tools: true, ...(rate === undefined ? {} : { rate }) };
      },
      reportedCostUsd: () => undefined,
      estimatesCost: true,
    },
  };
}
