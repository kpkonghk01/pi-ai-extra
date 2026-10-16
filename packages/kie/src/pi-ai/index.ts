import type { Provider } from "@earendil-works/pi-ai";
import { createChatProvider, helperImages, type ChatModelDefinition, type ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";
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

/**
 * Codex models on `POST /codex/v1/responses`. KIE documents dashed ids (it also accepts the
 * dotted ones); `catalogueId` points at pi-ai's dotted catalogue entry for capability metadata.
 */
const CODEX_MODELS: readonly ChatModelDefinition[] = [
  { id: "gpt-6-astra", protocol: "openai-responses" },
  { id: "gpt-5-6-sol", catalogueId: "gpt-5.6-sol", protocol: "openai-responses" },
  { id: "gpt-5-6-terra", catalogueId: "gpt-5.6-terra", protocol: "openai-responses" },
  { id: "gpt-5-6-luna", catalogueId: "gpt-5.6-luna", protocol: "openai-responses" },
  { id: "gpt-5-5", catalogueId: "gpt-5.5", protocol: "openai-responses" },
];
const CLAUDE_MODELS = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

/** Chat models documented by KIE: Codex (OpenAI Responses) and Claude (Anthropic Messages). */
export const KIE_CHAT_MODELS: readonly ChatModelDefinition[] = [
  ...CODEX_MODELS,
  ...CLAUDE_MODELS.map((id): ChatModelDefinition => ({ id, protocol: "anthropic-messages" })),
];

export interface KieProviderOptions {
  /** KIE API key from server-side secret configuration; used for chat and images. */
  apiKey: string;
  /** Replaces the default chat model list. The image models are always `KIE_IMAGE_MODELS`. */
  models?: readonly ChatModelDefinition[] | undefined;
  /** Codex (OpenAI Responses) parent path; pi-ai appends `/responses`. Default `https://api.kie.ai/codex/v1`. */
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
