import type { ImagesProvider, Provider } from "@earendil-works/pi-ai";
import {
  createChatProvider,
  createHelperImagesProvider,
  type ChatModelDefinition,
  type ChatProtocol,
} from "@hk01/pi-ai-extra-internal/pi-ai";
import { TOAPIS_BASE_URL, TOAPIS_IMAGES_API, TOAPIS_PROVIDER_ID, TOAPIS_PROVIDER_NAME, toapisResponsesBaseUrl } from "../constants.ts";
import { generateToapisImage, type ToapisImageRequest, type ToapisImageSettings } from "../generate.ts";
import { TOAPIS_IMAGE_MODELS } from "../models.ts";

export type { ChatModelDefinition, ChatProtocol } from "@hk01/pi-ai-extra-internal/pi-ai";

/** Chat models documented by ToAPIs: Codex (OpenAI Responses) and Claude (Anthropic Messages). */
export const TOAPIS_CHAT_MODELS: readonly ChatModelDefinition[] = [
  { id: "gpt-5.3-codex", protocol: "openai-responses" },
  { id: "gpt-5.3-codex-spark", protocol: "openai-responses" },
  { id: "gpt-5.3-codex-official", protocol: "openai-responses" },
  { id: "claude-opus-4-6", protocol: "anthropic-messages" },
  { id: "claude-sonnet-4-6", protocol: "anthropic-messages" },
  { id: "claude-haiku-4-5-20251001", protocol: "anthropic-messages" },
];

export interface ToapisProviderOptions {
  /** ToAPIs API key from server-side secret configuration. */
  apiKey: string;
  /** Replaces the default model list. */
  models?: readonly ChatModelDefinition[] | undefined;
  /** Default `https://toapis.com`; mainland China users may choose `https://toapis.cn` explicitly. */
  baseUrl?: string | undefined;
}

/**
 * pi-ai chat provider for ToAPIs. Codex models use pi-ai's OpenAI Responses adapter
 * (`<host>/v1/responses`); Claude models use its Anthropic Messages adapter (`<host>/v1/messages`).
 */
export function createToapisProvider(options: ToapisProviderOptions): Provider<ChatProtocol> {
  const host = (options.baseUrl ?? TOAPIS_BASE_URL).replace(/\/+$/, "");
  return createChatProvider({
    id: TOAPIS_PROVIDER_ID,
    name: TOAPIS_PROVIDER_NAME,
    apiKey: options.apiKey,
    baseUrls: { "openai-responses": toapisResponsesBaseUrl(host), "anthropic-messages": host },
    models: options.models ?? TOAPIS_CHAT_MODELS,
    anthropicAuth: "x-api-key",
  });
}

export interface ToapisImagesProviderOptions {
  apiKey: string;
  settings?: ToapisImageSettings | undefined;
}

/**
 * pi-ai `ImagesProvider` backed by `generateToapisImage`. Model options go in
 * `ImagesOptions.metadata` using the helper's option names and are validated strictly.
 */
export function createToapisImagesProvider(options: ToapisImagesProviderOptions): ImagesProvider {
  return createHelperImagesProvider({
    id: TOAPIS_PROVIDER_ID,
    name: TOAPIS_PROVIDER_NAME,
    api: TOAPIS_IMAGES_API,
    baseUrl: options.settings?.baseUrl ?? TOAPIS_BASE_URL,
    apiKey: options.apiKey,
    models: TOAPIS_IMAGE_MODELS,
    generate: (request) =>
      generateToapisImage({
        ...request.params,
        ...options.settings,
        model: request.model,
        prompt: request.prompt,
        referenceImages: request.referenceImages,
        apiKey: request.apiKey,
        signal: request.signal,
        fetch: request.fetch,
      } as ToapisImageRequest),
  });
}
