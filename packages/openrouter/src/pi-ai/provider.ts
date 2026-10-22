import type { Provider, SimpleStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  catalogueRate,
  explicitApiKeyAuth,
  reportedAmount,
  withLiveChatModels,
  type ChatProvider,
} from "@hk01/pi-ai-extra-internal/pi-ai";
import { isRecord, withoutTrailingSlash } from "@hk01/pi-ai-extra-internal/util";
import { fetchOpenRouterModels, type OpenRouterApi, type OpenRouterModelInfo } from "./live-models.ts";

/** OpenRouter's API root; pi-ai's models use `<root>/v1`. */
export const OPENROUTER_API_ROOT = "https://openrouter.ai/api";

export interface OpenRouterProviderOptions {
  /** OpenRouter API key from server-side secret configuration. */
  apiKey: string;
  /** API root override. Default `https://openrouter.ai/api`; chat requests and the model list go to `<baseUrl>/v1`. */
  baseUrl?: string | undefined;
  /** Custom fetch for chat requests and the live model list, for tests or instrumentation. A request's own `fetch` wins. */
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Moving aliases: every `-latest` id, with or without OpenRouter's `~` prefix
 * (`~google/gemini-flash-latest`, `~unbiased/pareto-latest`, `openai/gpt-chat-latest`). The model
 * one names can change at any time, which silently changes both its behaviour and its price.
 */
const MOVING_ALIAS = /-latest$/;

/**
 * Third-party routers, which pick the model for each request themselves, named one by one as
 * OpenRouter listed them on 2026-10-20; a description is never matched. OpenRouter's own routers
 * are every `openrouter/*` id. The live list also tags every router (`OpenRouterModelInfo.router`);
 * this list is for pi-ai's catalogue, which has no such tag.
 */
const THIRD_PARTY_ROUTERS: ReadonlySet<string> = new Set(["typesafe/jev-router", "nvidia/switchyard"]);

/**
 * Whether the chat kit offers an OpenRouter model id at all, on the live list and the installed
 * catalogue alike. Left out:
 *
 * - `:batch` variants: the chat kit sends no batch requests, and they get no document cache
 *   breakpoint;
 * - `:free` variants: they are heavily rate-limited, and their providers may train on the prompts,
 *   which does not suit a newsroom gateway;
 * - every model whose provider picks the model itself, by product-owner decision: OpenRouter's own
 *   routers (every `openrouter/*` id: `auto`, `auto-beta`, `fusion`, `free`, and any new one),
 *   `THIRD_PARTY_ROUTERS` and moving aliases (`MOVING_ALIAS`).
 *
 * Routers the live list tags, and image-output models, are left out as well (`chatKit.offers`).
 */
export function isOfferedOpenRouterId(id: string): boolean {
  return (
    !id.endsWith(":batch") &&
    !id.endsWith(":free") &&
    !id.startsWith("openrouter/") &&
    !THIRD_PARTY_ROUTERS.has(id) &&
    !MOVING_ALIAS.test(id)
  );
}

/**
 * pi-ai's OpenRouter provider (`openrouterProvider()`: its `openrouter` id, catalogue, OpenAI
 * Completions and Anthropic Messages adapters, and image and classifier models) with its
 * environment and OAuth auth replaced by the explicit key. A base URL replaces the API root of
 * every model (`<root>/v1` for Completions and images, `<root>` for Messages).
 *
 * It is a chat provider (ADR 0009):
 *
 * - `refreshModels` reads OpenRouter's public `GET <root>/v1/models` and replaces the chat models
 *   with every model there that answers in text (`fetchOpenRouterModels`). pi-ai's
 *   `personalizeOpenRouterCatalog` could narrow it to the key's own list later.
 * - `chatKit`: OpenRouter takes PDF and image documents, tools, and native structured output on
 *   its Anthropic Messages route. The chat kit offers a model unless its id is left out
 *   (`isOfferedOpenRouterId`), the live list tags it as a router, or it also answers with images
 *   (by the live list's output modalities, else by pi-ai's OpenRouter image catalogue). From the
 *   live list, a model reads PDFs and takes tools as `input_modalities` and `supported_parameters`
 *   say, and its rate is OpenRouter's price. From pi-ai's catalogue, which lists only models with
 *   tools, it reads no PDFs (some of its vendors' image models read no files) and its rate is the
 *   catalogue price. A turn's cost is OpenRouter's own `usage.cost`, else estimated.
 */
export function createOpenRouterProvider(options: OpenRouterProviderOptions): ChatProvider<OpenRouterApi> {
  const root = options.baseUrl === undefined ? OPENROUTER_API_ROOT : withoutTrailingSlash(options.baseUrl);
  const base = openrouterProvider();
  const rebase = <T extends { baseUrl: string }>(model: T): T =>
    root !== OPENROUTER_API_ROOT && model.baseUrl.startsWith(OPENROUTER_API_ROOT)
      ? { ...model, baseUrl: root + model.baseUrl.slice(OPENROUTER_API_ROOT.length) }
      : model;
  const installed = base.getModels().map(rebase);
  const allInstalled = (base.getAllModels?.() ?? base.getModels()).map(rebase);
  const imageModelIds = new Set(allInstalled.filter((model) => model.type === "image").map((model) => model.id));
  const fetch = options.fetch;
  const explicit: Provider<OpenRouterApi> = {
    ...base,
    auth: explicitApiKeyAuth("OpenRouter", options.apiKey),
    baseUrl: `${root}/v1`,
    getModels: () => installed,
    getAllModels: () => allInstalled,
    stream: (model, context, streamOptions) => base.stream(model, context, withFetch(streamOptions, fetch)),
    streamSimple: (model, context, streamOptions) => base.streamSimple(model, context, withFetch(streamOptions, fetch)),
  };
  // What the live list said about its models: set when that list is published, never ahead of it.
  let liveInfo = new Map<string, OpenRouterModelInfo>();
  const provider = withLiveChatModels(
    explicit,
    (signal) => fetchOpenRouterModels({ fetch: fetch ?? ((input, init) => globalThis.fetch(input, init)), root, installed, signal }),
    (read) => {
      liveInfo = read.info;
    },
  );
  return {
    ...provider,
    chatKit: {
      takes: { fileDocuments: true, tools: true, nativeStructuredOutput: true },
      offers: (model) => {
        if ((model.type ?? "chat") !== "chat" || !isOfferedOpenRouterId(model.id)) return false;
        const info = liveInfo.get(model.id);
        return info === undefined ? !imageModelIds.has(model.id) : !info.router && !info.imageOutput;
      },
      describe: (model) => {
        const info = liveInfo.get(model.id);
        const rate = info === undefined ? catalogueRate(model.cost) : info.rate;
        return { fileInput: info?.fileInput ?? false, tools: info?.tools ?? true, ...(rate === undefined ? {} : { rate }) };
      },
      // OpenRouter's own charge for the turn, `usage.cost`.
      reportedCostUsd: (raw) => (isRecord(raw.usage) ? reportedAmount(raw.usage.cost) : undefined),
      estimatesCost: true,
      fetch: options.fetch,
    },
  };
}

/** The request's options with `fetch` as its fetch unless it brings its own. */
function withFetch<T extends StreamOptions | SimpleStreamOptions>(options: T | undefined, fetch: typeof globalThis.fetch | undefined): T | undefined {
  return fetch === undefined || options?.fetch !== undefined ? options : ({ ...options, fetch } as T);
}
