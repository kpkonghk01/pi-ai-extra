import { createProvider, type Model, type ProviderStreams } from "@earendil-works/pi-ai";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { GOOGLE_VERTEX_MODELS } from "@earendil-works/pi-ai/providers/google-vertex.models";
import { assertModelRate, catalogueRate, explicitApiKeyAuth, modelCostAt, type ChatProvider, type ModelRate } from "@hk01/pi-ai-extra-internal/pi-ai";
import { GOOGLE_VERTEX_BASE_URL, GOOGLE_VERTEX_PROVIDER_ID, GOOGLE_VERTEX_PROVIDER_NAME } from "../constants.ts";
import { geminiChatTraits } from "./chat-traits.ts";
import { GEMINI_CHAT_MODELS, type GeminiChatModelDefinition } from "./rates.ts";
import { googleChatStreams } from "./streams.ts";

type VertexChatModel = Model<"google-vertex">;

const CATALOGUE: readonly VertexChatModel[] = Object.values(GOOGLE_VERTEX_MODELS) as VertexChatModel[];

/** Options of `createGoogleVertexProvider`. */
export interface GoogleVertexProviderOptions {
  /** Google Agent Platform express-mode API key, from server-side secret configuration. */
  apiKey: string;
  /**
   * Restrict the chat models to these ids, from pi-ai's `google-vertex` catalogue or the
   * definitions. Unknown ids throw; nothing is silently skipped.
   */
  modelIds?: readonly string[] | undefined;
  /** Replaces this package's Gemini definitions (`GEMINI_CHAT_MODELS`); pi-ai's catalogue stays. */
  models?: readonly GeminiChatModelDefinition[] | undefined;
  /** Ground chat answers with Google Search and URL context: both tools go on every request. Default `false`. */
  grounding?: boolean | undefined;
}

/**
 * pi-ai provider for Gemini on Google Agent Platform (formerly Vertex AI), in express mode: pi-ai's
 * own Vertex adapter, on the global endpoint (`GOOGLE_VERTEX_BASE_URL`), authenticated only with
 * the explicit `apiKey`.
 *
 * Unlike pi-ai's `googleVertexProvider()`, it never reads environment variables or Application
 * Default Credentials: every request carries the factory's key, even one called on the provider
 * itself, where pi-ai resolves none and its adapter would fall back to ADC with the project and
 * location from the environment. Each model names the endpoint, so the Google GenAI SDK does not
 * take one from `GOOGLE_VERTEX_BASE_URL`; the explicit key wins over the SDK's own
 * `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` and `GOOGLE_API_KEY`.
 *
 * Its models are pi-ai's `google-vertex` catalogue plus the Gemini definitions (`models`, default
 * `GEMINI_CHAT_MODELS`): a definition with a catalogue id replaces that entry's rate, and one with a
 * new id copies the capabilities of its `catalogueId`. A model is priced from its definition's
 * rate, else pi-ai's list price; `cost` is the period in force when the provider is created. An API
 * key cannot list Agent Platform models, so there is no live list (`refreshModels`).
 *
 * It is a chat provider (ADR 0009) with Gemini's traits (`geminiChatTraits`), and like
 * `createGoogleProvider` it turns the adjustable safety filters off and grounds when asked
 * (`googleChatStreams`). It serves no image models.
 */
export function createGoogleVertexProvider(options: GoogleVertexProviderOptions): ChatProvider<"google-vertex"> {
  const apiKey = expressApiKey(options.apiKey);
  const definitions = options.models ?? GEMINI_CHAT_MODELS;
  const rates = new Map<string, ModelRate | undefined>(CATALOGUE.map((model) => [model.id, catalogueRate(model.cost)]));
  for (const definition of definitions) rates.set(definition.id, definition.rate);
  const models = selectModels(vertexModels(definitions, Date.now()), options.modelIds);
  const provider = createProvider<"google-vertex">({
    id: GOOGLE_VERTEX_PROVIDER_ID,
    name: GOOGLE_VERTEX_PROVIDER_NAME,
    baseUrl: GOOGLE_VERTEX_BASE_URL,
    auth: explicitApiKeyAuth(GOOGLE_VERTEX_PROVIDER_NAME, apiKey),
    models,
    api: withKey(googleChatStreams(googleVertexApi(), options.grounding === true), apiKey),
  });
  return { ...provider, chatKit: geminiChatTraits((id) => rates.get(id)) };
}

/**
 * The catalogue, each entry replaced by the definition with its id, then the definitions of new
 * ids, all on the express endpoint. Each definition takes the capabilities of its `catalogueId` (default
 * its own id) and its `cost` from its rate at `at`. A definition with no catalogue entry to copy
 * from, or an invalid rate, throws a `TypeError`.
 */
function vertexModels(definitions: readonly GeminiChatModelDefinition[], at: number): VertexChatModel[] {
  const defined = new Map(definitions.map((definition) => [definition.id, fromDefinition(definition, at)]));
  const catalogue = CATALOGUE.map((model) => defined.get(model.id) ?? { ...model, baseUrl: GOOGLE_VERTEX_BASE_URL });
  return [...catalogue, ...[...defined.values()].filter((model) => !(model.id in GOOGLE_VERTEX_MODELS))];
}

function fromDefinition(definition: GeminiChatModelDefinition, at: number): VertexChatModel {
  const label = `${GOOGLE_VERTEX_PROVIDER_NAME} chat model ${definition.id}`;
  assertModelRate(definition.rate, label);
  const sourceId = definition.catalogueId ?? definition.id;
  const source = CATALOGUE.find((model) => model.id === sourceId);
  if (source === undefined) {
    throw new TypeError(`${label}: pi-ai's google-vertex catalogue has no ${sourceId} to copy capabilities from; set catalogueId to a catalogue id.`);
  }
  return {
    ...source,
    id: definition.id,
    name: sourceId === definition.id ? source.name : definition.id,
    baseUrl: GOOGLE_VERTEX_BASE_URL,
    cost: modelCostAt(definition.rate, at),
  };
}

function selectModels(models: readonly VertexChatModel[], modelIds: readonly string[] | undefined): readonly VertexChatModel[] {
  if (modelIds === undefined) return models;
  const known = models.map((model) => model.id);
  const unknown = modelIds.filter((id) => !known.includes(id));
  if (unknown.length > 0) {
    throw new TypeError(`${GOOGLE_VERTEX_PROVIDER_NAME}: unknown chat model id(s) ${unknown.join(", ")}. Known: ${known.join(", ")}.`);
  }
  return models.filter((model) => modelIds.includes(model.id));
}

/**
 * The key, unless pi-ai's Vertex adapter would take it for no key and use ADC instead: blank, its
 * ADC marker `gcp-vertex-credentials`, or a `<placeholder>`.
 */
function expressApiKey(apiKey: string): string {
  const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
  if (trimmed === "gcp-vertex-credentials" || /^<[^>]+>$/.test(trimmed)) {
    throw new TypeError(
      `${GOOGLE_VERTEX_PROVIDER_NAME}: apiKey must be an express-mode API key, not a placeholder or pi-ai's ADC marker, which would make pi-ai use Application Default Credentials.`,
    );
  }
  return apiKey;
}

/** The streams with `apiKey` on every request, in place of any key the caller resolved or left out. */
function withKey(inner: ProviderStreams, apiKey: string): ProviderStreams {
  return {
    ...inner,
    stream: (model, context, options) => inner.stream(model, context, { ...options, apiKey }),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, { ...options, apiKey }),
  };
}
