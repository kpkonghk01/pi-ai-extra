import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { getModelListJson, modelCostAt, roundRate, singleRate, type ModelRate, type TokenRates } from "@hk01/pi-ai-extra-internal/pi-ai";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";

/** The chat APIs pi-ai's OpenRouter provider uses. */
export type OpenRouterApi = "anthropic-messages" | "openai-completions";

/** pi-ai's selectable thinking levels, in order; `none` is OpenRouter's "off". */
const THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** What the live list says about a model beyond its pi-ai `Model`. */
export interface OpenRouterModelInfo {
  /** `file` is in `architecture.input_modalities`: it reads PDFs natively. */
  fileInput: boolean;
  /** `tools` is in `supported_parameters`. */
  tools: boolean;
  rate: ModelRate | undefined;
  /** It also answers with images (`architecture.output_modalities`). */
  imageOutput: boolean;
  /** OpenRouter tags it as a router (`architecture.tokenizer` is `Router`). */
  router: boolean;
}

/** A model from OpenRouter's public `GET /api/v1/models`, read defensively. */
interface OpenRouterListEntry {
  id: string;
  name?: unknown;
  context_length?: unknown;
  top_provider?: unknown;
  architecture?: unknown;
  pricing?: unknown;
  supported_parameters?: unknown;
  reasoning?: unknown;
}

/** The `architecture.tokenizer` OpenRouter gives its routers, third-party routers and `~` aliases. */
const ROUTER_TOKENIZER = "Router";

/**
 * OpenRouter's live chat list from its public `GET <root>/v1/models` (no key needed): every model
 * that answers in text, as a pi-ai model built the way pi-ai's own catalogue generator builds one
 * (`scripts/openrouter-catalog.ts` in pi-ai 1.2), with what pi-ai's `Model` has no field for in
 * `info`. Differences from the generator:
 *
 * - a model id pi-ai's catalogue already has keeps that entry (its API choice, compat and
 *   thinking fixes), updated with the live limits and price, as pi-ai's
 *   `personalizeOpenRouterCatalog` does;
 * - models without tool support are kept, with `info.tools` false;
 * - a new `anthropic/*` id goes through OpenAI Completions, not Anthropic Messages, so a new
 *   Claude family is never sent pi-ai's budget-thinking parameters, which it may reject;
 * - text and image input come from `architecture.input_modalities`.
 *
 * A list without a chat model throws.
 */
export async function fetchOpenRouterModels(input: {
  fetch: typeof globalThis.fetch;
  root: string;
  installed: readonly Model<OpenRouterApi>[];
  signal: AbortSignal;
}): Promise<{ models: Model<OpenRouterApi>[]; info: Map<string, OpenRouterModelInfo> }> {
  const body = await getModelListJson(input.fetch, `${input.root}/v1/models`, {}, input.signal);
  const entries = isRecord(body) && Array.isArray(body.data) ? body.data : undefined;
  if (entries === undefined) throw new Error("the OpenRouter model list has no data array");
  const installed = new Map(input.installed.map((model) => [model.id, model]));
  const models: Model<OpenRouterApi>[] = [];
  const info = new Map<string, OpenRouterModelInfo>();
  const now = Date.now();
  for (const entry of entries as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || info.has(entry.id)) continue;
    const listed = openRouterModel(entry as unknown as OpenRouterListEntry, installed.get(entry.id), input.root, now);
    if (listed === undefined) continue;
    models.push(listed.model);
    info.set(listed.model.id, listed.info);
  }
  if (models.length === 0) throw new Error("the OpenRouter model list lists no chat model");
  return { models, info };
}

function openRouterModel(
  entry: OpenRouterListEntry,
  known: Model<OpenRouterApi> | undefined,
  root: string,
  now: number,
): { model: Model<OpenRouterApi>; info: OpenRouterModelInfo } | undefined {
  const architecture = isRecord(entry.architecture) ? entry.architecture : {};
  const output = outputModalities(architecture);
  if (!output.includes("text")) return undefined;
  const input = inputModalities(architecture);
  const parameters = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
  const rate = openRouterRate(entry.pricing);
  const info: OpenRouterModelInfo = {
    fileInput: input.includes("file"),
    tools: parameters.includes("tools"),
    rate,
    imageOutput: output.includes("image"),
    router: architecture.tokenizer === ROUTER_TOKENIZER,
  };
  const topProvider = isRecord(entry.top_provider) ? entry.top_provider : {};
  // `||`: OpenRouter reports a missing limit as absent, null or 0, as pi-ai's generator reads it.
  const contextWindow = positive(topProvider.context_length) || positive(entry.context_length) || known?.contextWindow || 4096;
  const maxTokens = positive(topProvider.max_completion_tokens) || known?.maxTokens || 4096;
  const piInput: ("text" | "image")[] = input.includes("image") ? ["text", "image"] : ["text"];
  const cost = modelCostAt(rate, now);
  if (known !== undefined) return { model: { ...known, input: piInput, contextWindow, maxTokens, cost }, info };
  const thinkingLevelMap = openRouterThinkingLevelMap(entry.reasoning);
  const model: Model<"openai-completions"> = {
    id: entry.id,
    name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: `${root}/v1`,
    reasoning: parameters.includes("reasoning"),
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    input: piInput,
    cost,
    contextWindow,
    maxTokens,
  };
  return { model, info };
}

/** What the model answers with: `output_modalities`, else the `->` side of `modality`. Unknown: text. */
function outputModalities(architecture: Record<string, unknown>): readonly unknown[] {
  if (Array.isArray(architecture.output_modalities)) return architecture.output_modalities;
  if (typeof architecture.modality === "string" && architecture.modality.includes("->")) {
    return architecture.modality.split("->")[1]!.split("+");
  }
  return ["text"];
}

/** Text, image and file input from `input_modalities` (else `modality`); text always. */
function inputModalities(architecture: Record<string, unknown>): ("text" | "image" | "file")[] {
  const listed: unknown[] = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities
    : typeof architecture.modality === "string"
      ? architecture.modality.split("->")[0]!.split("+")
      : [];
  return (["text", "image", "file"] as const).filter((kind) => kind === "text" || listed.includes(kind));
}

/**
 * OpenRouter's per-token decimal-string prices as a one-period schedule in USD per 1M tokens,
 * as pi-ai's `openRouterCost` converts them, except that a missing, invalid or negative input or
 * output price (OpenRouter reports -1 for routers) is no rate rather than 0, and a missing cache
 * price is unpublished. The first prompt-length override (`min_prompt_tokens`, without a
 * time-of-day condition) becomes the large-prompt tier. A published zero price is a zero rate,
 * while pi-ai's catalogue zero reads as no rate (`catalogueRate`), so a model OpenRouter prices at
 * zero has a zero rate on the live list and none on the installed one.
 */
export function openRouterRate(pricing: unknown): ModelRate | undefined {
  if (!isRecord(pricing)) return undefined;
  const base = tokenRates(pricing, undefined);
  if (base === undefined) return undefined;
  const overrides = Array.isArray(pricing.overrides) ? pricing.overrides.filter(isRecord) : [];
  const tiers = overrides
    .filter((override) => typeof override.min_prompt_tokens === "number" && override.min_prompt_tokens > 0)
    .filter((override) => override.utc_start === undefined && override.utc_end === undefined && override.utc_days === undefined)
    .sort((a, b) => (a.min_prompt_tokens as number) - (b.min_prompt_tokens as number));
  const tier = tiers[0];
  const tierRates = tier === undefined ? undefined : tokenRates(tier, base);
  return singleRate({
    ...base,
    ...(tier === undefined || tierRates === undefined ? {} : { largePrompt: { overPromptTokens: tier.min_prompt_tokens as number, ...tierRates } }),
  });
}

/** The rates of a price or override; an override's missing rate keeps the base one. */
function tokenRates(prices: Record<string, unknown>, base: TokenRates | undefined): TokenRates | undefined {
  const input = perMillion(prices.prompt) ?? base?.input;
  const output = perMillion(prices.completion) ?? base?.output;
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = perMillion(prices.input_cache_read) ?? base?.cacheRead;
  const cacheWrite = perMillion(prices.input_cache_write) ?? base?.cacheWrite;
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }), ...(cacheWrite === undefined ? {} : { cacheWrite }) };
}

/** One $/token decimal string as $/1M tokens; missing, invalid or negative: not published. */
function perMillion(value: unknown): number | undefined {
  const perToken = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(perToken) && perToken >= 0 ? roundRate(perToken * 1_000_000) : undefined;
}

/**
 * OpenRouter's reasoning metadata as pi-ai thinking levels, ported from pi-ai 1.2's
 * `scripts/openrouter-reasoning-options.ts` and `getEffortThinkingLevelMap`: each listed effort
 * is selectable, the others are not, and `off` is `none` unless reasoning is mandatory.
 */
export function openRouterThinkingLevelMap(reasoning: unknown): ThinkingLevelMap | undefined {
  if (!isRecord(reasoning)) return undefined;
  const mandatory = reasoning.mandatory === true;
  const efforts = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : [];
  if (efforts.length === 0) return mandatory ? { off: null } : undefined;
  if (!THINKING_EFFORTS.some((level) => efforts.includes(level)) && !efforts.includes("none")) return mandatory ? { off: null } : undefined;
  const map: ThinkingLevelMap = { off: mandatory ? null : "none" };
  for (const level of THINKING_EFFORTS) map[level] = efforts.includes(level) ? level : null;
  return map;
}

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
