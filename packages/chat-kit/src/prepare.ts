import {
  getCurrentTools,
  normalizeContext,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { untilAborted } from "./abort.ts";
import type { TurnPricing } from "./cost.ts";
import {
  createDocumentMarker,
  documentKind,
  prepareDocument,
  SUPPORTED_DOCUMENT_TYPES,
  type DocumentKind,
  type PreparedDocument,
} from "./documents.ts";
import { errorText, TurnFailure } from "./errors.ts";
import { parseTurn, type TurnOptions } from "./input.ts";
import type { ProviderRegistry, RegisteredProvider } from "./registry.ts";
import type { ChatDocument, ChatModelRef } from "./types.ts";
import { wireApiFor, type PayloadPlan, type SchemaRequest, type WireApi } from "./wire/index.ts";
import { targetsOpenRouter } from "./wire/openrouter.ts";

/** Where a turn runs, as its reference names it: the pi-ai provider id and the model id. */
export interface TurnTarget {
  provider: string;
  model: string;
  /** The model's API, set once the model has resolved: a failure after that carries it on its message. */
  api?: Api;
}

/** A turn that passed every check, with its documents loaded: ready to send. */
export interface PreparedTurn {
  target: TurnTarget;
  /** The model to send: the listed one, with OpenRouter's `require_parameters` for a schema on Completions. */
  model: Model<Api>;
  wire: WireApi;
  /** The caller's context, with the documents' marker opening the first user message. */
  context: Context;
  plan: PayloadPlan;
  options: TurnOptions;
  /** The answer is the arguments of a forced tool call (a response schema on Anthropic Messages). */
  schemaAsToolCall: boolean;
  pricing: TurnPricing;
  /** The fetch the provider's factory was given, which a turn goes through unless the kit has its own. */
  providerFetch: typeof globalThis.fetch | undefined;
  /** pi-ai's `Models.streamSimple`, in the kit's `Models` collection. */
  send(model: Model<Api>, context: Context, options: ModelsSimpleStreamOptions): AssistantMessageEventStream;
}

/** Everything checked before any document is loaded or any request is sent. */
export async function prepareTurn(
  registry: ProviderRegistry,
  ref: ChatModelRef,
  context: Context,
  rawOptions: TurnOptions | undefined,
  target: TurnTarget,
  signal: AbortSignal,
): Promise<PreparedTurn> {
  const validation = parseTurn(ref, context, rawOptions);
  if (!validation.ok) throw new TurnFailure("INVALID_REQUEST", `Invalid turn: ${validation.message}`);
  const { options } = validation;
  const documents = options.documents ?? [];
  const declaresTools = getCurrentTools(normalizeContext(context).messages).length > 0;
  if (declaresTools && options.responseSchema !== undefined) {
    throw new TurnFailure(
      "INVALID_REQUEST",
      "A turn takes declared tools or a response schema, not both: tools serve an agent turn, a response schema a Gem turn.",
    );
  }
  if (documents.length > 0 && !context.messages.some((message) => message.role === "user")) {
    throw new TurnFailure("INVALID_REQUEST", "Documents open the first user message, and the context has none.");
  }

  const entry = registry.providers.get(ref.provider);
  if (!entry) throw new TurnFailure("UNKNOWN_MODEL", `No provider with the id ${JSON.stringify(ref.provider)} is registered.`);
  const startedAt = Date.now();
  const { model, snapshot } = await untilAborted(entry.models.find(ref.id), signal, () => signal.reason);
  const unread = snapshot.refreshError === undefined ? "" : ` (its live model list could not be read: ${snapshot.refreshError})`;
  if (!model) throw new TurnFailure("UNKNOWN_MODEL", `Model ${JSON.stringify(ref.id)} is not offered by provider ${entry.id}${unread}.`);
  target.api = model.api;
  const wire = wireApiFor(model.api);
  if (!wire) throw new TurnFailure("UNSUPPORTED", `chat-kit does not support the ${JSON.stringify(model.api)} API of this model.`);
  const described = entry.traits.describe(model);
  // From the installed list, a model reads only what the installed catalogue says it reads.
  const installedNote = snapshot.source === "installed" ? unread : "";

  if (declaresTools || hasToolHistory(context.messages)) checkTools(entry, model, described.tools);
  if (!model.input.includes("image") && hasImages(context.messages)) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Model ${model.id} does not read images${installedNote}, so the images in the context cannot be sent.`,
    );
  }
  const reads = { pdf: described.fileInput, image: model.input.includes("image") };
  const kinds = documents.map((document) => checkDocument(document, entry, model, reads, installedNote));
  const schemaRequest: SchemaRequest = {
    responseSchema: options.responseSchema,
    reasoning: options.reasoning,
    nativeStructuredOutput: entry.traits.takes.nativeStructuredOutput,
  };
  const unsupported = wire.unsupported(model, schemaRequest);
  if (unsupported) throw new TurnFailure("UNSUPPORTED", `This model cannot take this request: ${unsupported}`);

  const prepared = await untilAborted(
    Promise.all(documents.map((document, index) => loadDocument(document, kinds[index]!, wire, model))),
    signal,
    () => signal.reason,
  );
  const marker = prepared.length > 0 ? createDocumentMarker() : undefined;
  const schemaAsToolCall = options.responseSchema !== undefined && wire.schemaAsToolCall(model, schemaRequest);
  const toOpenRouter = targetsOpenRouter(model);
  return {
    target,
    model: options.responseSchema !== undefined && model.api === "openai-completions" && toOpenRouter ? withRequiredParameters(model) : model,
    wire,
    context: withDocumentMarker(context, marker),
    plan: {
      marker,
      documents: prepared,
      responseSchema: options.responseSchema,
      targetsOpenRouter: toOpenRouter,
      nativeStructuredOutput: options.responseSchema !== undefined && !schemaAsToolCall && entry.traits.takes.nativeStructuredOutput,
    },
    options,
    schemaAsToolCall,
    pricing: { policy: entry.traits, rate: described.rate, startedAt },
    providerFetch: entry.traits.fetch,
    send: (sent, sentContext, sentOptions) => registry.models.streamSimple(sent, sentContext, sentOptions),
  };
}

/** Tools pass through to pi-ai only where the provider takes them (verified live) and the model does. */
function checkTools(entry: RegisteredProvider, model: Model<Api>, modelTakesTools: boolean): void {
  if (!entry.traits.takes.tools) {
    throw new TurnFailure("UNSUPPORTED", `Provider ${entry.id} does not take tools yet (not verified live), so this turn's tools, tool calls or tool results cannot be sent.`);
  }
  if (!modelTakesTools) throw new TurnFailure("UNSUPPORTED", `Model ${model.id} does not take tools, so this turn's tools, tool calls or tool results cannot be sent.`);
}

/**
 * Whether the conversation holds tool calls or tool results that will reach the request: a provider
 * that takes no tools cannot take those either. An assistant message that errored or was aborted is
 * not counted, because pi-ai's `transformMessages` drops it before sending; a tool result is, even
 * one whose call sat in a dropped message, because pi-ai sends it.
 */
function hasToolHistory(messages: readonly Message[]): boolean {
  return messages.some((message) => {
    if (message.role === "toolResult") return true;
    if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return false;
    return blocksOf(message).some((block) => block.type === "toolCall");
  });
}

/** A message's content blocks: none for the text of a user or system message. The messages are already checked (`parseTurn`). */
function blocksOf(message: Message): readonly { type: string }[] {
  const content: unknown = message.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Whether a user message or tool result carries an image. pi-ai replaces an image with
 * placeholder text for a model without image input; the kit refuses the turn instead, as ADR 0003
 * forbids silently discarding reference images.
 */
function hasImages(messages: readonly Message[]): boolean {
  return messages.some(
    (message) => (message.role === "user" || message.role === "toolResult") && blocksOf(message).some((part) => part.type === "image"),
  );
}

function checkDocument(
  document: ChatDocument,
  entry: RegisteredProvider,
  model: Model<Api>,
  reads: { pdf: boolean; image: boolean },
  installedNote: string,
): DocumentKind {
  const kind = documentKind(document.mimeType);
  if (kind === undefined) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Document ${JSON.stringify(document.name)} has type ${JSON.stringify(document.mimeType)}; supported types are ${SUPPORTED_DOCUMENT_TYPES.join(", ")}.`,
    );
  }
  if (kind === "text") return kind;
  if (!entry.traits.takes.fileDocuments) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Provider ${entry.id} does not take PDF or image documents yet (its file input is undocumented), so ${JSON.stringify(document.name)} cannot be sent.`,
    );
  }
  if (!reads[kind]) {
    const takes = !reads.pdf && !reads.image ? "takes text only" : `does not read ${kind === "pdf" ? "PDF files natively" : "images"}`;
    throw new TurnFailure("UNSUPPORTED", `Model ${model.id} ${takes}${installedNote}, so it cannot read ${JSON.stringify(document.name)}.`);
  }
  return kind;
}

async function loadDocument(document: ChatDocument, kind: DocumentKind, wire: WireApi, model: Model<Api>): Promise<PreparedDocument> {
  try {
    return await prepareDocument(document, kind, wire.placeDocument(document, model));
  } catch (error) {
    throw new TurnFailure("INVALID_REQUEST", `Document ${JSON.stringify(document.name)} could not be loaded: ${errorText(error)}`, {
      cause: error,
    });
  }
}

/**
 * The context with the documents' marker opening the first user message, so the prompt is
 * identical across turns, and across sessions of the same documents, up to the end of the
 * documents, which lets provider prompt caching reuse it. Each wire's payload transform replaces
 * the marker with the documents' parts.
 */
function withDocumentMarker(context: Context, marker: string | undefined): Context {
  if (marker === undefined) return context;
  const first = context.messages.findIndex((message) => message.role === "user");
  const messages = context.messages.map((message, index): Message => {
    if (index !== first || message.role !== "user") return message;
    const rest = typeof message.content === "string" ? (message.content ? [{ type: "text" as const, text: message.content }] : []) : message.content;
    return { ...message, content: [{ type: "text", text: marker }, ...rest] };
  });
  return { ...context, messages };
}

/** The model with OpenRouter asked to route only to endpoints that honour every request parameter (the response schema). */
function withRequiredParameters(model: Model<Api>): Model<Api> {
  const compat = (model.compat ?? {}) as { openRouterRouting?: Record<string, unknown> };
  return { ...model, compat: { ...compat, openRouterRouting: { ...compat.openRouterRouting, require_parameters: true } } } as Model<Api>;
}
