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
import { createGoogleProvider, googleChatRate } from "@hk01/pi-ai-extra-google/pi-ai";
import { catalogueRate, type ModelRate } from "@hk01/pi-ai-extra-internal/rates";
import { createKieProvider, KIE_CHAT_MODELS } from "@hk01/pi-ai-extra-kie/pi-ai";
import { createToapisProvider, TOAPIS_CHAT_MODELS } from "@hk01/pi-ai-extra-toapis/pi-ai";
import type { ChatProviderConfig, ChatProviderKind } from "./types.ts";

/** What differs between provider kinds. */
interface ProviderKindSpec {
  /**
   * Whether the provider takes PDF and image documents, through each API's native file input.
   * Plain-text documents are sent as text blocks, so every provider takes those. KIE and ToAPIs
   * do not document their file input, so it stays off until a live smoke test enables it.
   */
  readonly fileDocuments: boolean;
  /** The pi-ai provider for an explicit key; `root` (no trailing slash) replaces its default API root. */
  create(apiKey: string, root: string | undefined): Provider;
  /** The rate schedule of an installed model: the package definitions' rates, Gemini's rate table, or OpenRouter's catalogue price. */
  rateOf(model: Model<Api>): ModelRate | undefined;
}

/** A chat model the provider offers, with its rate schedule (undefined when it has no rate). */
export interface ListedModel {
  readonly model: Model<Api>;
  readonly rate: ModelRate | undefined;
}

/** The rate of a package definition, by id. */
function definitionRate(definitions: readonly { id: string; rate?: ModelRate | undefined }[]): (model: Model<Api>) => ModelRate | undefined {
  return (model) => definitions.find((definition) => definition.id === model.id)?.rate;
}

/** One entry per `ChatProviderKind`; the record type makes a missing kind a type error. */
const PROVIDER_KIND_SPECS: Readonly<Record<ChatProviderKind, ProviderKindSpec>> = {
  google: {
    fileDocuments: true,
    create: (apiKey, root) => createGoogleProvider({ apiKey, ...(root ? { baseUrl: root } : {}) }),
    rateOf: (model) => googleChatRate(model.id),
  },
  openrouter: { fileDocuments: true, create: explicitOpenRouterProvider, rateOf: (model) => catalogueRate(model.cost) },
  kie: {
    fileDocuments: false,
    create: (apiKey, root) =>
      createKieProvider({ apiKey, ...(root ? { responsesBaseUrl: `${root}/openai/v1`, claudeBaseUrl: `${root}/anthropic` } : {}) }),
    rateOf: definitionRate(KIE_CHAT_MODELS),
  },
  toapis: {
    fileDocuments: false,
    create: (apiKey, root) => createToapisProvider({ apiKey, ...(root ? { baseUrl: root } : {}) }),
    rateOf: definitionRate(TOAPIS_CHAT_MODELS),
  },
};

/** An auth context with no environment and no files, so pi-ai never finds an ambient key. */
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

const OPENROUTER_API_ROOT = "https://openrouter.ai/api";

/** One configured provider, under the consumer's name, in its own pi-ai `Models` collection. */
export interface RegisteredProvider {
  readonly kind: ChatProviderKind;
  readonly grounding: boolean;
  /** See `ProviderKindSpec.fileDocuments`. */
  readonly fileDocuments: boolean;
  /** The chat model with this id and its rate, or undefined. */
  findModel(id: string): ListedModel | undefined;
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
    const spec = PROVIDER_KIND_SPECS[config.provider];
    const provider = spec.create(config.apiKey, config.baseUrl?.replace(/\/+$/, ""));
    const models = createModels({ authContext: NO_AMBIENT_AUTH });
    models.setProvider(provider);
    registry.set(config.name, {
      kind: config.provider,
      grounding: config.grounding === true,
      fileDocuments: spec.fileDocuments,
      findModel: (id) => {
        const model = models.getModel(provider.id, id);
        return model === undefined ? undefined : { model, rate: spec.rateOf(model) };
      },
      streamSimple: (model, context, options) => models.streamSimple(model, context, options),
    });
  }
  return registry;
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
