import { createProvider, type Model, type ModelCost, type Provider, type ProviderHeaders, type ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { explicitApiKeyAuth } from "./auth.ts";

export type ChatProtocol = "openai-responses" | "anthropic-messages";

/** A chat model offered through a provider's OpenAI Responses or Anthropic Messages endpoint. */
export interface ChatModelDefinition {
  id: string;
  protocol: ChatProtocol;
  name?: string | undefined;
  reasoning?: boolean | undefined;
  input?: ("text" | "image")[] | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  /** Per-million-token cost used for pi-ai usage accounting. Defaults to zero (provider pricing differs from list prices). */
  cost?: ModelCost | undefined;
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
}

const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

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
    models: input.models.map((definition) => buildChatModel(input.id, input.baseUrls[definition.protocol], definition)),
    api: {
      "openai-responses": wrap(openAIResponsesApi()),
      "anthropic-messages": input.anthropicAuth === "bearer" ? bearerAuthStreams(anthropic) : anthropic,
    },
  });
}

/**
 * Builds a pi-ai model. Capability metadata (reasoning, context window, thinking
 * levels, request compatibility) is copied from pi-ai's built-in catalogue when the
 * id matches; Anthropic "allowed fallback models" are removed because fallback is prohibited.
 */
export function buildChatModel(provider: string, baseUrl: string, definition: ChatModelDefinition): Model<ChatProtocol> {
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
    cost: definition.cost ?? ZERO_COST,
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
  const candidate = catalog[definition.id];
  return candidate?.api === definition.protocol ? candidate : undefined;
}

function withoutFallbackModels(compat: object): object {
  const { allowedFallbackModels: _removed, ...rest } = compat as Record<string, unknown>;
  return rest;
}
