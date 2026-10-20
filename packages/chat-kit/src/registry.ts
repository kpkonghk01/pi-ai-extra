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
import { fetchGeminiModels, isGeminiChatModel } from "./models/gemini.ts";
import { createModelList, type ListedModel, type ModelList } from "./models/list.ts";
import { fetchOpenRouterModels, listsInstalledOpenRouterModel } from "./models/openrouter.ts";
import { fetchKieModels, fetchToapisModels } from "./models/resellers.ts";
import type { ChatModelInput, ChatProviderConfig, ChatProviderKind } from "./types.ts";

export type { ListedModel } from "./models/list.ts";

/** What a live list read gets: the key, the configured API root and the installed models to match. */
interface LiveListContext {
  apiKey: string;
  /** The configured API root (no trailing slash), or undefined for the provider's default. */
  root: string | undefined;
  provider: Provider;
  fetch: typeof globalThis.fetch;
  installed: readonly ListedModel[];
  signal: AbortSignal;
  now: number;
}

/** What differs between provider kinds. */
interface ProviderKindSpec {
  /**
   * Whether the provider takes PDF and image documents, through each API's native file input.
   * Plain-text documents are sent as text blocks, so every provider takes those. KIE and ToAPIs
   * do not document their file input, so it stays off until a live smoke test enables it.
   */
  readonly fileDocuments: boolean;
  /**
   * Whether the provider takes Anthropic's native structured output (`output_config.format`) on
   * its Anthropic Messages route, so a response schema works on a model that thinks. On for
   * OpenRouter, whose Messages reference documents `output_config.format`
   * (https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message), though a
   * live check is still pending. On for KIE, which does not document it but answered valid JSON
   * under it, while thinking, in a live check on 2026-10-16 (`claude-opus-5-5`). Off for ToAPIs
   * until a live smoke test verifies it.
   */
  readonly nativeStructuredOutput: boolean;
  /** The pi-ai provider for an explicit key; `root` (no trailing slash) replaces its default API root. */
  create(apiKey: string, root: string | undefined): Provider;
  /**
   * Which installed models are listed and run while no live list has been read: the models the
   * live list would keep. Gemini keeps plain chat models under their own ids; OpenRouter drops
   * `:batch` and `:free` models.
   */
  listsInstalled(model: Model<Api>): boolean;
  /**
   * What an installed model reads. pi-ai's catalogues list text and image input only. The Gemini,
   * Claude and GPT models that read images read PDFs too, so `file` follows `image` there.
   * OpenRouter's catalogue spans many vendors, some of whose models read images but not files
   * (`moondream/moondream3-preview`), so an installed OpenRouter model reads no files: a PDF turn
   * on it fails with `UNSUPPORTED` until its live list says it reads files.
   */
  installedInput(model: Model<Api>): ChatModelInput[];
  /** The rate schedule of an installed model: the package definitions' rates, Gemini's rate table, or OpenRouter's catalogue price. */
  rateOf(model: Model<Api>): ModelRate | undefined;
  /** Reads the provider's live model list. */
  fetchLive(context: LiveListContext): Promise<readonly ListedModel[]>;
}

const OPENROUTER_API_ROOT = "https://openrouter.ai/api";
const KIE_HOST = "https://api.kie.ai";
const TOAPIS_HOST = "https://toapis.com";

/** The rate of a package definition, by id. */
function definitionRate(definitions: readonly { id: string; rate?: ModelRate | undefined }[]): (model: Model<Api>) => ModelRate | undefined {
  return (model) => definitions.find((definition) => definition.id === model.id)?.rate;
}

/** `file` follows `image`: the model reads PDFs when it reads images. */
function fileWithImage(model: Model<Api>): ChatModelInput[] {
  return model.input.includes("image") ? ["text", "image", "file"] : ["text"];
}

/** One entry per `ChatProviderKind`; the record type makes a missing kind a type error. */
const PROVIDER_KIND_SPECS: Readonly<Record<ChatProviderKind, ProviderKindSpec>> = {
  google: {
    fileDocuments: true,
    nativeStructuredOutput: false,
    create: (apiKey, root) => createGoogleProvider({ apiKey, ...(root ? { baseUrl: root } : {}) }),
    listsInstalled: (model) => isGeminiChatModel(model.id),
    installedInput: fileWithImage,
    rateOf: (model) => googleChatRate(model.id),
    fetchLive: (context) => fetchGeminiModels({ ...context, baseUrl: context.provider.baseUrl ?? context.root ?? "" }),
  },
  openrouter: {
    fileDocuments: true,
    nativeStructuredOutput: true,
    create: explicitOpenRouterProvider,
    listsInstalled: listsInstalledOpenRouterModel,
    installedInput: (model) => (model.input.includes("image") ? ["text", "image"] : ["text"]),
    rateOf: (model) => catalogueRate(model.cost),
    fetchLive: (context) => fetchOpenRouterModels({ ...context, root: context.root ?? OPENROUTER_API_ROOT }),
  },
  kie: {
    fileDocuments: false,
    nativeStructuredOutput: true,
    create: (apiKey, root) =>
      createKieProvider({ apiKey, ...(root ? { responsesBaseUrl: `${root}/openai/v1`, claudeBaseUrl: `${root}/anthropic` } : {}) }),
    listsInstalled: () => true,
    installedInput: fileWithImage,
    rateOf: definitionRate(KIE_CHAT_MODELS),
    fetchLive: (context) => fetchKieModels({ ...context, host: context.root ?? KIE_HOST }),
  },
  toapis: {
    fileDocuments: false,
    nativeStructuredOutput: false,
    create: (apiKey, root) => createToapisProvider({ apiKey, ...(root ? { baseUrl: root } : {}) }),
    listsInstalled: () => true,
    installedInput: fileWithImage,
    rateOf: definitionRate(TOAPIS_CHAT_MODELS),
    fetchLive: (context) => fetchToapisModels({ ...context, host: context.root ?? TOAPIS_HOST }),
  },
};

/** An auth context with no environment and no files, so pi-ai never finds an ambient key. */
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/** One configured provider, under the consumer's name, in its own pi-ai `Models` collection. */
export interface RegisteredProvider {
  /** The consumer's provider name. */
  readonly name: string;
  readonly kind: ChatProviderKind;
  readonly grounding: boolean;
  /** See `ProviderKindSpec.fileDocuments`. */
  readonly fileDocuments: boolean;
  /** See `ProviderKindSpec.nativeStructuredOutput`. */
  readonly nativeStructuredOutput: boolean;
  /** The provider's model list: live, with the installed catalogue or definitions until one is read. */
  readonly models: ModelList;
  streamSimple(model: Model<Api>, context: Context, options: ModelsSimpleStreamOptions): AssistantMessageEventStream;
}

export interface RegistryOptions {
  fetch: typeof globalThis.fetch | undefined;
  /** The clock for list freshness; tests replace it. */
  now?: (() => number) | undefined;
}

/**
 * Registers each provider with its explicit key. Every provider gets its own `Models` collection,
 * created with an empty auth context: pi-ai never reads `process.env`, and two names may share a
 * provider kind (for example two Gemini keys) without one replacing the other. Each also gets its
 * own model list, read with the same key.
 */
export function createProviderRegistry(configs: readonly ChatProviderConfig[], options: RegistryOptions): ReadonlyMap<string, RegisteredProvider> {
  const now = options.now ?? Date.now;
  const registry = new Map<string, RegisteredProvider>();
  for (const config of configs) {
    const spec = PROVIDER_KIND_SPECS[config.provider];
    const root = config.baseUrl?.replace(/\/+$/, "");
    const provider = spec.create(config.apiKey, root);
    const models = createModels({ authContext: NO_AMBIENT_AUTH });
    models.setProvider(provider);
    const installed = provider
      .getModels()
      .filter((model) => spec.listsInstalled(model))
      .map((model): ListedModel => ({ model, rate: spec.rateOf(model), input: spec.installedInput(model) }));
    registry.set(config.name, {
      name: config.name,
      kind: config.provider,
      grounding: config.grounding === true,
      fileDocuments: spec.fileDocuments,
      nativeStructuredOutput: spec.nativeStructuredOutput,
      models: createModelList({
        installed,
        now,
        fetchLive: (signal) =>
          spec.fetchLive({
            apiKey: config.apiKey,
            root,
            provider,
            fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
            installed,
            signal,
            now: now(),
          }),
      }),
      streamSimple: (model, context, streamOptions) => models.streamSimple(model, context, streamOptions),
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
