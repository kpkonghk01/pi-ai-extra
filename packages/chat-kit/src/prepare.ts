import type { Api, Context, Message, Model, Usage } from "@earendil-works/pi-ai";
import {
  createDocumentMarker,
  documentKind,
  prepareDocument,
  SUPPORTED_DOCUMENT_TYPES,
  type DocumentKind,
  type PreparedDocument,
} from "./documents.ts";
import { untilAborted } from "./abort.ts";
import type { TurnPricing } from "./cost.ts";
import { errorText, TurnFailure } from "./errors.ts";
import { parseTurnInput } from "./input.ts";
import type { ListedModel, RegisteredProvider } from "./registry.ts";
import type { ChatDocument, ChatTurnInput, ChatTurnSettings } from "./types.ts";
import { wireApiFor, type PayloadPlan, type WireApi } from "./wire/index.ts";
import { targetsOpenRouter } from "./wire/openrouter.ts";

/** Where a turn runs, as its input names it: the consumer's provider name and the model id. */
export interface TurnTarget {
  provider: string;
  model: string;
}

/** A turn that passed every check, with its documents loaded: ready to send. */
export interface PreparedTurn {
  target: TurnTarget;
  provider: RegisteredProvider;
  model: Model<Api>;
  wire: WireApi;
  context: Context;
  plan: PayloadPlan;
  settings: ChatTurnSettings;
  /** The answer is the arguments of a forced tool call (a response schema on Anthropic Messages). */
  schemaAsToolCall: boolean;
  pricing: TurnPricing;
}

/** pi-ai requires usage on every assistant message, including the history the kit replays. */
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Everything checked before any document is loaded or any request is sent. */
export async function prepareTurn(
  registry: ReadonlyMap<string, RegisteredProvider>,
  input: ChatTurnInput,
  target: TurnTarget,
  signal: AbortSignal,
): Promise<PreparedTurn> {
  const validation = parseTurnInput(input);
  if (!validation.ok) throw new TurnFailure("INVALID_REQUEST", `Invalid turn input: ${validation.message}`);
  const provider = registry.get(input.provider);
  if (!provider) throw new TurnFailure("UNKNOWN_MODEL", `No provider named ${JSON.stringify(input.provider)} is configured.`);
  const startedAt = Date.now();
  const { model: listed, snapshot } = await untilAborted(provider.models.find(input.model), signal, turnAborted);
  if (!listed) {
    const why = snapshot.refreshError === undefined ? "" : ` (its live model list could not be read: ${snapshot.refreshError})`;
    throw new TurnFailure("UNKNOWN_MODEL", `Model ${JSON.stringify(input.model)} is not in the ${provider.kind} model list${why}.`);
  }
  const { model } = listed;
  const wire = wireApiFor(model.api);
  if (!wire) throw new TurnFailure("UNSUPPORTED", `chat-kit does not support the ${JSON.stringify(model.api)} API of this model.`);
  const settings = input.settings ?? {};
  const kinds = input.documents.map((document) => checkDocument(document, provider, listed));
  const unsupported = wire.unsupported(model, { responseSchema: input.responseSchema, settings });
  if (unsupported) throw new TurnFailure("UNSUPPORTED", `This model cannot take this request: ${unsupported}`);

  const documents = await untilAborted(
    Promise.all(input.documents.map((document, index) => loadDocument(document, kinds[index]!, wire, model))),
    signal,
    turnAborted,
  );
  const marker = documents.length > 0 ? createDocumentMarker() : undefined;
  return {
    target,
    provider,
    model,
    wire,
    context: buildContext(input, model, marker),
    plan: {
      marker,
      documents,
      responseSchema: input.responseSchema,
      grounding: provider.grounding,
      targetsOpenRouter: targetsOpenRouter(model),
    },
    settings,
    schemaAsToolCall: wire.schemaAsToolCall && input.responseSchema !== undefined,
    pricing: { kind: provider.kind, rate: listed.rate, startedAt },
  };
}

function checkDocument(document: ChatDocument, provider: RegisteredProvider, listed: ListedModel): DocumentKind {
  const kind = documentKind(document.mimeType);
  if (kind === undefined) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Document ${JSON.stringify(document.name)} has type ${JSON.stringify(document.mimeType)}; supported types are ${SUPPORTED_DOCUMENT_TYPES.join(", ")}.`,
    );
  }
  if (kind === "text") return kind;
  if (!provider.fileDocuments) {
    throw new TurnFailure(
      "UNSUPPORTED",
      `Provider ${provider.kind} does not take PDF or image documents yet (its file input is undocumented), so ${JSON.stringify(document.name)} cannot be sent.`,
    );
  }
  const reads = kind === "pdf" ? "file" : "image";
  if (!listed.input.includes(reads)) {
    const takes = listed.input.length === 1 ? "takes text only" : `does not read ${kind === "pdf" ? "PDF files" : "images"}`;
    throw new TurnFailure("UNSUPPORTED", `Model ${listed.model.id} ${takes}, so it cannot read ${JSON.stringify(document.name)}.`);
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
 * The transcript: system prompt, history, then the new message. The documents' marker opens the
 * first user turn (the first user message of the history, otherwise the new message), so the
 * prompt is identical across turns, and across sessions of the same documents, up to the end of
 * the documents, which lets provider prompt caching reuse it.
 */
function buildContext(input: ChatTurnInput, model: Model<Api>, marker: string | undefined): Context {
  const firstUser = input.history.findIndex((entry) => entry.role === "user");
  const timestamp = Date.now();
  const user = (text: string, withMarker: boolean): Message => ({
    role: "user",
    content:
      withMarker && marker !== undefined
        ? [
            { type: "text", text: marker },
            { type: "text", text },
          ]
        : text,
    timestamp,
  });
  const messages: Message[] = input.history.map((entry, index) =>
    entry.role === "user"
      ? user(entry.text, index === firstUser)
      : {
          role: "assistant",
          content: [{ type: "text", text: entry.text }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: ZERO_USAGE,
          stopReason: "stop",
          timestamp,
        },
  );
  messages.push(user(input.message, firstUser === -1));
  return { ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}), messages };
}

function turnAborted(): TurnFailure {
  return new TurnFailure("ABORTED", "The turn was aborted.");
}
