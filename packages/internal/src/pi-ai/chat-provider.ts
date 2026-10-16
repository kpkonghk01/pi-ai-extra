import { createProvider, type Model, type Provider, type ProviderHeaders, type ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { explicitApiKeyAuth } from "./auth.ts";
import { assertModelRate, modelCostAt, type ModelRate } from "./rates.ts";
import type { HelperImages } from "./images-provider.ts";

export type ChatProtocol = "openai-responses" | "anthropic-messages";

/** A chat model offered through a provider's OpenAI Responses or Anthropic Messages endpoint. */
export interface ChatModelDefinition {
  id: string;
  protocol: ChatProtocol;
  /**
   * pi-ai built-in catalogue id to copy capability metadata from, when the provider spells the
   * model id differently (for example KIE `gpt-5-6-sol` is pi-ai `gpt-5.6-sol`). Defaults to `id`.
   */
  catalogueId?: string | undefined;
  name?: string | undefined;
  reasoning?: boolean | undefined;
  input?: ("text" | "image")[] | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  /**
   * The model's published rate schedule, in USD per 1M tokens. Never copied from pi-ai's catalogue
   * (provider prices differ from list prices). The packages' default model lists set it from each
   * provider's published rates and offer no model without one. Omitted: the model has no rate,
   * never a zero rate. pi-ai's `Model.cost` is set from the period in force when the provider is
   * created, and is all zeros for a model with no rate (a placeholder: pi-ai requires the field);
   * the chat kit prices each turn from the schedule at call time.
   */
  rate?: ModelRate | undefined;
}

export interface ChatProviderInput {
  id: string;
  name: string;
  apiKey: string;
  baseUrls: Record<ChatProtocol, string>;
  models: readonly ChatModelDefinition[];
  /** How the Anthropic Messages endpoint authenticates. KIE requires `Authorization: Bearer`. */
  anthropicAuth: "x-api-key" | "bearer";
  /** Optional provider quirk adapter applied to both protocol stream implementations. */
  wrapStreams?: ((streams: ProviderStreams) => ProviderStreams) | undefined;
  /** Image models served by the same provider (pi-ai 1.2 keeps chat and image models in one `Models`). */
  images?: HelperImages | undefined;
}

const DEFAULTS: Record<ChatProtocol, { contextWindow: number; maxTokens: number }> = {
  "openai-responses": { contextWindow: 400_000, maxTokens: 128_000 },
  "anthropic-messages": { contextWindow: 200_000, maxTokens: 64_000 },
};

export function createChatProvider(input: ChatProviderInput): Provider<ChatProtocol> {
  const wrap = input.wrapStreams ?? ((streams: ProviderStreams) => streams);
  const anthropic = wrap(anthropicMessagesApi());
  return createProvider<ChatProtocol>({
    id: input.id,
    name: input.name,
    auth: explicitApiKeyAuth(input.name, input.apiKey),
    models: [
      ...input.models.map((definition) => buildChatModel(input.id, input.baseUrls[definition.protocol], definition)),
      ...(input.images?.models ?? []),
    ],
    api: {
      "openai-responses": wrap(openAIResponsesApi()),
      "anthropic-messages": input.anthropicAuth === "bearer" ? bearerAuthStreams(anthropic) : anthropic,
    },
    ...(input.images ? { images: input.images.images } : {}),
  });
}

/**
 * Builds a pi-ai model. Capability metadata (reasoning, context window, thinking
 * levels, request compatibility) is copied from pi-ai's built-in catalogue when the
 * id (or `catalogueId`) matches; Anthropic "allowed fallback models" are removed because
 * fallback is prohibited. Prices are never copied: `cost` is the period of `definition.rate` in
 * force at `at` (default now), or pi-ai's required placeholder when the model has no rate. An
 * invalid rate schedule throws a `TypeError`.
 */
export function buildChatModel(provider: string, baseUrl: string, definition: ChatModelDefinition, at: Date = new Date()): Model<ChatProtocol> {
  if (definition.rate !== undefined) assertModelRate(definition.rate, `${provider} chat model ${definition.id}`);
  const builtin = findBuiltinModel(definition);
  const defaults = DEFAULTS[definition.protocol];
  const model: Model<ChatProtocol> = {
    id: definition.id,
    name: definition.name ?? builtin?.name ?? definition.id,
    api: definition.protocol,
    provider,
    baseUrl,
    reasoning: definition.reasoning ?? builtin?.reasoning ?? true,
    input: definition.input ?? builtin?.input ?? ["text", "image"],
    cost: modelCostAt(definition.rate, at),
    contextWindow: definition.contextWindow ?? builtin?.contextWindow ?? defaults.contextWindow,
    maxTokens: definition.maxTokens ?? builtin?.maxTokens ?? defaults.maxTokens,
    ...(builtin?.thinkingLevelMap ? { thinkingLevelMap: builtin.thinkingLevelMap } : {}),
    ...(builtin?.inputLimits ? { inputLimits: builtin.inputLimits } : {}),
    ...(builtin?.compat ? { compat: withoutFallbackModels(builtin.compat) as NonNullable<Model<ChatProtocol>["compat"]> } : {}),
  };
  return model;
}

/** Sends the resolved API key as `Authorization: Bearer` instead of Anthropic's `x-api-key`. */
export function bearerAuthStreams(inner: ProviderStreams): ProviderStreams {
  return {
    stream: (model, context, options) => inner.stream(model, context, toBearer(options)),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, toBearer(options)),
  };
}

function toBearer<T extends { apiKey?: string; headers?: ProviderHeaders }>(options: T | undefined): T | undefined {
  if (!options?.apiKey) return options;
  const { apiKey, ...rest } = options;
  return { ...rest, headers: { ...rest.headers, Authorization: `Bearer ${apiKey}` } } as unknown as T;
}

function findBuiltinModel(definition: ChatModelDefinition): Model<ChatProtocol> | undefined {
  const catalog: Record<string, Model<ChatProtocol>> =
    definition.protocol === "anthropic-messages"
      ? (ANTHROPIC_MODELS as unknown as Record<string, Model<ChatProtocol>>)
      : (OPENAI_MODELS as unknown as Record<string, Model<ChatProtocol>>);
  const candidate = catalog[definition.catalogueId ?? definition.id];
  return candidate?.api === definition.protocol ? candidate : undefined;
}

function withoutFallbackModels(compat: object): object {
  const { allowedFallbackModels: _removed, ...rest } = compat as Record<string, unknown>;
  return rest;
}
