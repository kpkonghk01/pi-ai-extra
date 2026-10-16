import type { Provider } from "@earendil-works/pi-ai";
import { createChatProvider, helperImages, publishedCost, type ChatModelDefinition, type ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";
import {
  KIE_API_BASE_URL,
  KIE_CLAUDE_BASE_URL,
  KIE_IMAGES_API,
  KIE_PROVIDER_ID,
  KIE_PROVIDER_NAME,
  KIE_RESPONSES_BASE_URL,
} from "../constants.ts";
import { generateKieImage, type KieImageRequest, type KieImageSettings } from "../generate.ts";
import { KIE_IMAGE_MODELS } from "../models.ts";
import { kieEnvelopeStreams } from "./envelope-fetch.ts";

export type { ChatModelDefinition, ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

/*
 * Rates as of 2026-10-16, source: https://kie.ai/pricing, read from
 * `POST https://api.kie.ai/client/v1/model-pricing/page` with
 * `{"pageNum":1,"pageSize":100,"interfaceType":"chat"}`. KIE prices chat in credits per
 * 1M tokens; 1 credit = $0.005 (the same listing's `usdPrice`).
 */
const USD_PER_CREDIT = 0.005;

/** KIE credits per 1M tokens to USD per 1M tokens (`publishedCost` rounds the result). */
function usd(credits: number): number {
  return credits * USD_PER_CREDIT;
}

/**
 * KIE publishes no cache rates for Claude, so `publishedCost` fills them in: cache reads at the
 * input rate (an upper bound) and cache writes at 1.25 × input (Anthropic's 5-minute write).
 */
function claude(id: string, inputCredits: number, outputCredits: number): ChatModelDefinition {
  return { id, protocol: "anthropic-messages", cost: publishedCost({ input: usd(inputCredits), output: usd(outputCredits) }) };
}

/**
 * Codex models on `POST /openai/v1/responses`. KIE documents dashed ids (it also accepts the
 * dotted ones); `catalogueId` points at pi-ai's dotted catalogue entry for capability metadata.
 * Costs: input, output, cached input and cache writes as published (credits per 1M tokens).
 *
 * `gpt-5-5` is listed and priced by KIE but was rejected on both Codex routes in a live check on
 * 2026-10-16 ("not supported when using Codex with a ChatGPT account"), so it is not offered.
 */
const CODEX_MODELS: readonly ChatModelDefinition[] = [
  {
    id: "gpt-6-astra",
    protocol: "openai-responses",
    cost: publishedCost({ input: usd(560), output: usd(2800), cacheRead: usd(56), cacheWrite: usd(700) }),
  },
  {
    id: "gpt-5-6-sol",
    catalogueId: "gpt-5.6-sol",
    protocol: "openai-responses",
    cost: publishedCost({ input: usd(280), output: usd(1680), cacheRead: usd(28), cacheWrite: usd(350) }),
  },
  {
    id: "gpt-5-6-terra",
    catalogueId: "gpt-5.6-terra",
    protocol: "openai-responses",
    cost: publishedCost({ input: usd(112), output: usd(672), cacheRead: usd(11.2), cacheWrite: usd(140) }),
  },
  {
    id: "gpt-5-6-luna",
    catalogueId: "gpt-5.6-luna",
    protocol: "openai-responses",
    cost: publishedCost({ input: usd(11.2), output: usd(67.2), cacheRead: usd(1.12), cacheWrite: usd(14) }),
  },
];

/** Claude models on Anthropic Messages, with input and output credits per 1M tokens. */
const CLAUDE_MODELS: readonly ChatModelDefinition[] = [
  claude("claude-fable-5", 800, 4000),
  claude("claude-opus-5", 400, 2000),
  claude("claude-opus-4-8", 400, 2000),
  claude("claude-opus-4-7", 285, 1430),
  claude("claude-opus-4-6", 285, 1430),
  claude("claude-opus-4-5", 285, 1430),
  claude("claude-sonnet-5", 170, 855),
  claude("claude-sonnet-4-6", 170, 855),
  claude("claude-sonnet-4-5", 170, 855),
  claude("claude-haiku-4-5", 55, 285),
];

/**
 * Chat models documented by KIE: Codex (OpenAI Responses) and Claude (Anthropic Messages),
 * priced in USD per 1M tokens from KIE's published rates (see above).
 */
export const KIE_CHAT_MODELS: readonly ChatModelDefinition[] = [...CODEX_MODELS, ...CLAUDE_MODELS];

export interface KieProviderOptions {
  /** KIE API key from server-side secret configuration; used for chat and images. */
  apiKey: string;
  /** Replaces the default chat model list. The image models are always `KIE_IMAGE_MODELS`. */
  models?: readonly ChatModelDefinition[] | undefined;
  /** Codex (OpenAI Responses) parent path; pi-ai appends `/responses`. Default `https://api.kie.ai/openai/v1`. */
  responsesBaseUrl?: string | undefined;
  /** Claude (Anthropic Messages) base URL; pi-ai appends `/v1/messages`. Default `https://api.kie.ai/anthropic`. */
  claudeBaseUrl?: string | undefined;
  /** Image helper settings (`apiBaseUrl`, `uploadBaseUrl`, `poll`) applied to every image request. */
  imageSettings?: KieImageSettings | undefined;
}

/**
 * pi-ai provider for KIE. Codex models use pi-ai's OpenAI Responses adapter; Claude
 * models use its Anthropic Messages adapter with KIE's Bearer authentication.
 *
 * It also serves `KIE_IMAGE_MODELS` (`models.getModelOfType("image", "kie", id)`),
 * generated through `generateKieImage`. Image options go in `ImagesOptions.metadata`
 * using the helper's option names (for example `{ aspectRatio: "16:9", resolution: "2K" }`)
 * and are validated strictly.
 */
export function createKieProvider(options: KieProviderOptions): Provider<ChatProtocol> {
  return createChatProvider({
    id: KIE_PROVIDER_ID,
    name: KIE_PROVIDER_NAME,
    apiKey: options.apiKey,
    baseUrls: {
      "openai-responses": options.responsesBaseUrl ?? KIE_RESPONSES_BASE_URL,
      "anthropic-messages": options.claudeBaseUrl ?? KIE_CLAUDE_BASE_URL,
    },
    models: options.models ?? KIE_CHAT_MODELS,
    anthropicAuth: "bearer",
    wrapStreams: kieEnvelopeStreams,
    images: helperImages({
      provider: KIE_PROVIDER_ID,
      api: KIE_IMAGES_API,
      baseUrl: options.imageSettings?.apiBaseUrl ?? KIE_API_BASE_URL,
      apiKey: options.apiKey,
      models: KIE_IMAGE_MODELS,
      settings: options.imageSettings,
      generate: (request) => generateKieImage(request as unknown as KieImageRequest),
    }),
  });
}
