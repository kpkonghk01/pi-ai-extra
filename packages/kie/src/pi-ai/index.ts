import {
  createChatProvider,
  helperImages,
  reportedAmount,
  roundRate,
  roundUsd,
  singleRate,
  withLiveChatModels,
  type ChatModelDefinition,
  type ChatProtocol,
  type ChatProvider,
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
import { kieChatStreams } from "./chat-streams.ts";
import { fetchKieModels } from "./live-models.ts";

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

/*
 * Rates as of 2026-10-16, source: https://kie.ai/pricing, read from
 * `POST https://api.kie.ai/client/v1/model-pricing/page` with
 * `{"pageNum":1,"pageSize":100,"interfaceType":"chat"}`. KIE prices chat in credits per
 * 1M tokens (`KIE_USD_PER_CREDIT`). KIE publishes no dates for Codex and Claude, so each of their
 * schedules is one period. An unpublished cache rate is left out; pricing derives it
 * (`toModelCost`).
 *
 * The Gemini rates are as of 2026-11-03, from the same listing (`interfaceType` `chat`) and the
 * model pages (kie.ai/gemini-3-8-flash, /gemini-3-6-flash, /gemini-4-argon). Each is a
 * limited-time price:
 *
 * - Gemini 3.8 and 3.6 Flash: 45 / 225 credits per 1M input / output tokens, "50% OFF until Dec
 *   31, 2026 at 06:00 UTC (prices shown are discounted)", so the published regular price is
 *   90 / 450, a second period. A period starts at 00:00 UTC, so it starts on 2026-12-31, six hours
 *   before the discount ends.
 * - Gemini 4 Argon: 160 / 800 credits, which "follow Google's promotional pricing and are valid
 *   until Nov 30, 2026". KIE publishes no later price, so the schedule is one period; when KIE
 *   publishes the price from 2026-12-01, a patch release adds it.
 *
 * A turn's cost is KIE's own charge either way (`reportedCostUsd`).
 */

/**
 * USD per KIE credit: $0.005, the `usdPrice` of KIE's pricing listing. It converts KIE's chat
 * rates (credits per 1M tokens) and a turn's reported `credits_consumed` to USD.
 */
export const KIE_USD_PER_CREDIT = 0.005;

/** KIE credits per 1M tokens to USD per 1M tokens (`11.2 × 0.005` is `0.056`). */
function usd(credits: number): number {
  return roundRate(credits * KIE_USD_PER_CREDIT);
}

/**
 * A Codex model on `POST /openai/v1/responses`, with input, output, cached-input and cache-write
 * credits per 1M tokens, all published. KIE documents dashed ids (it also accepts the dotted
 * ones); `catalogueId` points at pi-ai's dotted catalogue entry for capability metadata.
 */
function codex(
  id: string,
  credits: { input: number; output: number; cacheRead: number; cacheWrite: number },
  catalogueId?: string,
): ChatModelDefinition {
  return {
    id,
    ...(catalogueId === undefined ? {} : { catalogueId }),
    protocol: "openai-responses",
    rate: singleRate({
      input: usd(credits.input),
      output: usd(credits.output),
      cacheRead: usd(credits.cacheRead),
      cacheWrite: usd(credits.cacheWrite),
    }),
  };
}

/** A Claude model on Anthropic Messages, with input and output credits per 1M tokens; KIE publishes no cache rates for Claude. */
function claude(id: string, inputCredits: number, outputCredits: number): ChatModelDefinition {
  return { id, protocol: "anthropic-messages", rate: singleRate({ input: usd(inputCredits), output: usd(outputCredits) }) };
}

/** A period of a KIE rate in credits per 1M tokens; only a later period has a `from` day. */
interface CreditPeriod {
  from?: string;
  input: number;
  output: number;
}

/**
 * A Gemini model on OpenAI Chat Completions, not on KIE's Gemini-native route (ADR 0010). KIE names
 * the model in the URL path (`/<id>-openai/v1/chat/completions`), so each definition carries its
 * own base URL (`/<id>-openai/v1`). Limits are pi-ai's Gemini catalogue values for 3.8 and 3.6
 * Flash (1,048,576 context, 65,536 output); KIE publishes a 1M budget for 4 Argon and no output
 * limit, so it takes the Flash value. KIE's `reasoning_effort` takes `low` and `high` only: pi-ai
 * sends the nearest of them (`minimal` and an explicit `off` as `low`; `medium`, `xhigh` and `max`
 * as `high`), and none when the turn sets no level.
 */
function gemini(id: string, name: string, periods: readonly CreditPeriod[]): ChatModelDefinition {
  return {
    id,
    name,
    protocol: "openai-completions",
    baseUrl: `${KIE_API_BASE_URL}/${id}-openai/v1`,
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null },
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    rate: {
      periods: periods.map(({ from, input, output }) => ({ ...(from === undefined ? {} : { from }), input: usd(input), output: usd(output) })),
    },
  };
}

/**
 * Codex models. `gpt-5-5` is listed and priced by KIE but was rejected on both Codex routes in a
 * live check on 2026-10-16 ("not supported when using Codex with a ChatGPT account"), so it is not
 * offered.
 */
const CODEX_MODELS: readonly ChatModelDefinition[] = [
  codex("gpt-6-1-sol", { input: 120, output: 600, cacheRead: 6, cacheWrite: 150 }, "gpt-6.1-sol"),
  codex("gpt-6-astra", { input: 560, output: 2800, cacheRead: 56, cacheWrite: 700 }),
  codex("gpt-6-sol", { input: 120, output: 600, cacheRead: 12, cacheWrite: 150 }),
  codex("gpt-6-luna", { input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 }),
  codex("gpt-5-6-sol", { input: 280, output: 1680, cacheRead: 28, cacheWrite: 350 }, "gpt-5.6-sol"),
  codex("gpt-5-6-terra", { input: 112, output: 672, cacheRead: 11.2, cacheWrite: 140 }, "gpt-5.6-terra"),
  codex("gpt-5-6-luna", { input: 11.2, output: 67.2, cacheRead: 1.12, cacheWrite: 14 }, "gpt-5.6-luna"),
];

/** Claude models on Anthropic Messages. */
const CLAUDE_MODELS: readonly ChatModelDefinition[] = [
  claude("claude-opus-5-5", 320, 1600),
  claude("claude-sonnet-5-5", 160, 800),
  claude("claude-haiku-5-5", 12, 60),
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
 * Gemini models. KIE has no list that names them (its two model lists are Codex's and Claude's), so
 * they are offered from these definitions, and a model KIE withdraws fails with KIE's own message.
 */
const GEMINI_MODELS: readonly ChatModelDefinition[] = [
  gemini("gemini-3-8-flash", "Gemini 3.8 Flash", [{ input: 45, output: 225 }, { from: "2026-12-31", input: 90, output: 450 }]),
  gemini("gemini-3-6-flash", "Gemini 3.6 Flash", [{ input: 45, output: 225 }, { from: "2026-12-31", input: 90, output: 450 }]),
  gemini("gemini-4-argon", "Gemini 4 Argon", [{ input: 160, output: 800 }]),
];

/**
 * Chat models documented by KIE: Codex (OpenAI Responses), Claude (Anthropic Messages) and Gemini
 * (OpenAI Chat Completions), priced in USD per 1M tokens from KIE's published rates (see above).
 */
export const KIE_CHAT_MODELS: readonly ChatModelDefinition[] = [...CODEX_MODELS, ...CLAUDE_MODELS, ...GEMINI_MODELS];

/** Options of `createKieProvider`. */
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
  /** Custom fetch for chat requests and the live model list, for tests or instrumentation. A request's own `fetch` wins. */
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * pi-ai provider for KIE. Codex models use pi-ai's OpenAI Responses adapter; Claude
 * models use its Anthropic Messages adapter with KIE's Bearer authentication.
 *
 * It is a chat provider (ADR 0009):
 *
 * - `refreshModels` reads KIE's Codex and Claude lists and keeps the Codex and Claude models they
 *   name (`fetchKieModels`). The Gemini models are always kept: no KIE list names them.
 * - `chatKit`: KIE's file input and tools are undocumented, so neither is taken until a live
 *   smoke test; native structured output answered valid JSON while thinking in a live check on
 *   2026-10-16 (`claude-opus-5-5`). Every chat model is offered, reads PDFs when it reads images,
 *   and is priced from its definition's rate. A turn's cost is KIE's own charge,
 *   `credits_consumed` × `KIE_USD_PER_CREDIT`, never an estimate: KIE's token counts are
 *   unreliable (hidden prompt tokens, some zero input counts).
 *
 * It also serves `KIE_IMAGE_MODELS` (`models.getModelOfType("image", "kie", id)`),
 * generated through `generateKieImage`. Image options go in `ImagesOptions.metadata`
 * using the helper's option names (for example `{ aspectRatio: "16:9", resolution: "2K" }`)
 * and are validated strictly.
 */
export function createKieProvider(options: KieProviderOptions): ChatProvider<ChatProtocol> {
  const definitions = options.models ?? KIE_CHAT_MODELS;
  const responsesBaseUrl = options.responsesBaseUrl ?? KIE_RESPONSES_BASE_URL;
  const claudeBaseUrl = options.claudeBaseUrl ?? KIE_CLAUDE_BASE_URL;
  const base = createChatProvider({
    id: KIE_PROVIDER_ID,
    name: KIE_PROVIDER_NAME,
    apiKey: options.apiKey,
    baseUrls: { "openai-responses": responsesBaseUrl, "anthropic-messages": claudeBaseUrl },
    models: definitions,
    anthropicAuth: "bearer",
    wrapStreams: kieChatStreams,
    fetch: options.fetch,
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
  const installed = base.getModels();
  const provider = withLiveChatModels(base, (signal) =>
    fetchKieModels({
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      apiKey: options.apiKey,
      responsesBaseUrl,
      claudeBaseUrl,
      installed,
      signal,
    }),
  );
  return {
    ...provider,
    chatKit: {
      takes: { fileDocuments: false, tools: false, nativeStructuredOutput: true },
      offers: (model) => (model.type ?? "chat") === "chat",
      describe: (model) => {
        const rate = definitions.find((definition) => definition.id === model.id)?.rate;
        return { fileInput: model.input.includes("image"), tools: true, ...(rate === undefined ? {} : { rate }) };
      },
      reportedCostUsd: (raw) => {
        const credits = reportedAmount(raw.credits_consumed);
        return credits === undefined ? undefined : roundUsd(credits * KIE_USD_PER_CREDIT);
      },
      estimatesCost: false,
      fetch: options.fetch,
    },
  };
}
