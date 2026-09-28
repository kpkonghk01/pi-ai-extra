import type { ImagesProvider, Provider } from "@earendil-works/pi-ai";
import {
  createChatProvider,
  createHelperImagesProvider,
  type ChatModelDefinition,
  type ChatProtocol,
} from "@hk01/pi-ai-extra-internal/pi-ai";
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

export type { ChatModelDefinition, ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

const CODEX_MODELS = ["gpt-5-codex", "gpt-5.1-codex", "gpt-5.2-codex", "gpt-5.3-codex", "gpt-5.4-codex"];
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

/** Chat models documented by KIE: GPT Codex (OpenAI Responses) and Claude (Anthropic Messages). */
export const KIE_CHAT_MODELS: readonly ChatModelDefinition[] = [
  ...CODEX_MODELS.map((id): ChatModelDefinition => ({ id, protocol: "openai-responses" })),
  ...CLAUDE_MODELS.map((id): ChatModelDefinition => ({ id, protocol: "anthropic-messages" })),
];

export interface KieProviderOptions {
  /** KIE API key from server-side secret configuration. */
  apiKey: string;
  /** Replaces the default model list. */
  models?: readonly ChatModelDefinition[] | undefined;
  /** Default `https://api.kie.ai/api/v1`. */
  responsesBaseUrl?: string | undefined;
  /** Default `https://api.kie.ai/claude`. */
  claudeBaseUrl?: string | undefined;
}

/**
 * pi-ai chat provider for KIE. Codex models use pi-ai's OpenAI Responses adapter;
 * Claude models use its Anthropic Messages adapter with KIE's Bearer authentication.
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
  });
}

export interface KieImagesProviderOptions {
  apiKey: string;
  settings?: KieImageSettings | undefined;
}

/**
 * pi-ai `ImagesProvider` backed by `generateKieImage`. Model options go in
 * `ImagesOptions.metadata` using the helper's option names (for example
 * `{ aspectRatio: "16:9", resolution: "2K" }`) and are validated strictly.
 */
export function createKieImagesProvider(options: KieImagesProviderOptions): ImagesProvider {
  return createHelperImagesProvider({
    id: KIE_PROVIDER_ID,
    name: KIE_PROVIDER_NAME,
    api: KIE_IMAGES_API,
    baseUrl: options.settings?.apiBaseUrl ?? KIE_API_BASE_URL,
    apiKey: options.apiKey,
    models: KIE_IMAGE_MODELS,
    generate: (request) =>
      generateKieImage({
        ...request.params,
        ...options.settings,
        model: request.model,
        prompt: request.prompt,
        referenceImages: request.referenceImages,
        apiKey: request.apiKey,
        signal: request.signal,
        fetch: request.fetch,
      } as KieImageRequest),
  });
}
