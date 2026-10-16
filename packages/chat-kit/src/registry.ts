import {
  createModels,
  type Api,
  type AssistantMessageEventStream,
  type AuthContext,
  type Context,
  type Model,
  type ModelsSimpleStreamOptions,
  type Provider,
  type ProviderAuth,
} from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createGoogleProvider } from "@hk01/pi-ai-extra-google/pi-ai";
import { createKieProvider } from "@hk01/pi-ai-extra-kie/pi-ai";
import { createToapisProvider } from "@hk01/pi-ai-extra-toapis/pi-ai";
import type { ChatProviderConfig, ChatProviderKind } from "./types.ts";

/**
 * Which providers may take which documents. Plain-text documents are sent as text blocks, so
 * every provider takes them. PDFs and images use each API's native file input: KIE and ToAPIs
 * do not document theirs, so it stays off until a live smoke test enables it.
 */
export const DOCUMENT_SUPPORT: Readonly<Record<ChatProviderKind, { text: boolean; files: boolean }>> = {
  google: { text: true, files: true },
  openrouter: { text: true, files: true },
  kie: { text: true, files: false },
  toapis: { text: true, files: false },
};

/** An auth context with no environment and no files, so pi-ai never finds an ambient key. */
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

const OPENROUTER_API_ROOT = "https://openrouter.ai/api";

/** One configured provider, under the consumer's name, in its own pi-ai `Models` collection. */
export interface RegisteredProvider {
  readonly name: string;
  readonly kind: ChatProviderKind;
  readonly grounding: boolean;
  readonly documents: { text: boolean; files: boolean };
  /**
   * The chat model with this id, or undefined. Today this is the provider's pi-ai catalogue
   * (static, frozen at release). DATA-4568 resolves it against the live model list here
   * (`listModels()`), so `runTurn` keeps one lookup.
   */
  findModel(id: string): Model<Api> | undefined;
  streamSimple(model: Model<Api>, context: Context, options: ModelsSimpleStreamOptions): AssistantMessageEventStream;
}

/**
 * Registers each provider with its explicit key. Every provider gets its own `Models` collection,
 * created with an empty auth context: pi-ai never reads `process.env`, and two names may share a
 * provider kind (for example two Gemini keys) without one replacing the other.
 */
export function createProviderRegistry(configs: readonly ChatProviderConfig[]): ReadonlyMap<string, RegisteredProvider> {
  const registry = new Map<string, RegisteredProvider>();
  for (const config of configs) {
    const provider = buildProvider(config);
    const models = createModels({ authContext: NO_AMBIENT_AUTH });
    models.setProvider(provider);
    registry.set(config.name, {
      name: config.name,
      kind: config.provider,
      grounding: config.grounding === true,
      documents: DOCUMENT_SUPPORT[config.provider],
      findModel: (id) => models.getModel(provider.id, id),
      streamSimple: (model, context, options) => models.streamSimple(model, context, options),
    });
  }
  return registry;
}

function buildProvider(config: ChatProviderConfig): Provider {
  const root = config.baseUrl?.replace(/\/+$/, "");
  switch (config.provider) {
    case "google":
      return createGoogleProvider({ apiKey: config.apiKey, ...(root ? { baseUrl: root } : {}) });
    case "openrouter":
      return explicitOpenRouterProvider(config.apiKey, root);
    case "kie":
      return createKieProvider({
        apiKey: config.apiKey,
        ...(root ? { responsesBaseUrl: `${root}/openai/v1`, claudeBaseUrl: `${root}/anthropic` } : {}),
      });
    case "toapis":
      return createToapisProvider({ apiKey: config.apiKey, ...(root ? { baseUrl: root } : {}) });
  }
}

/**
 * pi-ai's built-in OpenRouter provider (catalogue, OpenAI Completions and Anthropic Messages
 * adapters) with its environment and OAuth auth replaced by the explicit key. A base URL
 * replaces the API root of both adapters (`<root>/v1` for Completions, `<root>` for Messages).
 */
function explicitOpenRouterProvider(apiKey: string, root: string | undefined): Provider {
  const base = openrouterProvider();
  const rebase = <T extends { baseUrl: string }>(model: T): T =>
    root && model.baseUrl.startsWith(OPENROUTER_API_ROOT)
      ? { ...model, baseUrl: root + model.baseUrl.slice(OPENROUTER_API_ROOT.length) }
      : model;
  return {
    ...base,
    auth: explicitApiKeyAuth("OpenRouter", apiKey),
    ...(root ? { baseUrl: `${root}/v1` } : {}),
    getModels: () => base.getModels().map(rebase),
    getAllModels: () => (base.getAllModels?.() ?? base.getModels()).map(rebase),
  } as Provider;
}

function explicitApiKeyAuth(providerName: string, apiKey: string): ProviderAuth {
  return {
    apiKey: {
      name: `${providerName} API key`,
      resolve: async () => ({ auth: { apiKey }, source: "explicit apiKey" }),
    },
  };
}
