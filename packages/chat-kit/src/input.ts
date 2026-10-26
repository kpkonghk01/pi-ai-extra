// pi-ai's own list of thinking levels, from which its `ThinkingLevel` type is derived. It is
// exported only from this subpath, not from the package root.
import { THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import type { Context } from "@earendil-works/pi-ai";
import type { ChatProvider } from "@hk01/pi-ai-extra-internal/pi-ai";
import { z } from "zod";
import { errorText, readOr } from "./errors.ts";
import { assertChatProvider } from "./registry.ts";
import type { ChatDocument, ChatKitOptions, ChatModelRef, ChatResponseSchema } from "./types.ts";

const nonEmpty = z.string().refine((value) => value.trim().length > 0, "must not be empty");

const kitOptionsSchema = z.strictObject({
  providers: z.array(z.unknown()),
  fetch: z.custom<typeof globalThis.fetch>((value) => typeof value === "function", "must be a function").optional(),
});

/** A message lists this many invalid fields at most, each cut at the length below: a context of thousands of bad messages, or an `Unrecognized keys` issue naming thousands of keys, must not make a message of megabytes. */
const MAX_LISTED_ISSUES = 10;
const MAX_ISSUE_LENGTH = 200;

const clip = (text: string): string => (text.length > MAX_ISSUE_LENGTH ? `${text.slice(0, MAX_ISSUE_LENGTH)}…` : text);

/** One line per invalid field: where it is, and why. */
function issueLines(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`)).join("");
    return clip(`${prefix}${path}: ${issue.message}`);
  });
}

/** The first lines, and how many more there were. */
function summarise(lines: readonly string[]): string {
  const more = lines.length - MAX_LISTED_ISSUES;
  return (more > 0 ? [...lines.slice(0, MAX_LISTED_ISSUES), `and ${more} more`] : lines).join("; ");
}

/**
 * Validates the kit options. Anything that is not a chat provider throws a `TypeError` here,
 * before any turn runs; so does a duplicate provider id (`createProviderRegistry`).
 */
export function parseKitOptions(options: ChatKitOptions): { providers: ChatProvider[]; fetch: typeof globalThis.fetch | undefined } {
  const parsed = kitOptionsSchema.safeParse(options);
  if (!parsed.success) throw new TypeError(`chat-kit: invalid options: ${summarise(issueLines(parsed.error, "options"))}`);
  const providers = parsed.data.providers.map((candidate, index) => {
    assertChatProvider(candidate, `providers[${index}]`);
    return candidate;
  });
  return { providers, fetch: parsed.data.fetch };
}

const modelRefSchema = z.looseObject({ provider: nonEmpty, id: nonEmpty });

const documentSchema = z.looseObject({
  name: nonEmpty,
  mimeType: nonEmpty,
  url: z.url({ protocol: /^https?$/ }).optional(),
  size: z.int().nonnegative().optional(),
  load: z.custom<() => Promise<Uint8Array>>((value) => typeof value === "function", "must be a function"),
});

/** A content block of a message: the kit reads its `type`, and pi-ai the rest. */
const blockSchema = z.looseObject({ type: z.string() });

/**
 * Message content as pi-ai's `Message` types it: blocks, or for a user or system message text. A
 * missing one (`null` or `undefined`) is invalid: pi-ai 1.2.0's `transformMessages` would read it
 * as empty, but its token estimate throws on it, in a position that depends on the messages around it.
 */
const blocksSchema = z.array(blockSchema);
const textOrBlocksSchema = z.union([z.string(), blocksSchema]);

/** Whether `JSON.stringify` can serialise the value: the kit hands schemas to pi-ai and the provider as JSON. */
const serialisable = (value: unknown): boolean =>
  readOr(() => {
    JSON.stringify(value);
    return true;
  }, false);

/** A plain JSON Schema object, as a response schema or a tool's `parameters`. */
const jsonSchemaObject = z
  .custom<object>((value) => typeof value === "object" && value !== null && !Array.isArray(value), "must be a JSON Schema object")
  .refine(serialisable, "must be serialisable as JSON (no cycle or BigInt)");

/** A tool as pi-ai's `Context.tools` holds it. */
const toolSchema = z.looseObject({ name: nonEmpty, description: z.string(), parameters: jsonSchemaObject });

/**
 * The tools a system message adds (`toolsAdded`) and removes (`toolsRemoved`, pi-ai's
 * `ToolReference`s). The kit reads their names, and pi-ai and the provider read an added tool's
 * `parameters`, so those must serialise. pi-ai reads a missing list (`null` too) as empty.
 */
const toolsAddedSchema = z.array(z.looseObject({ name: z.string(), parameters: z.custom<unknown>(serialisable, "must be serialisable as JSON").optional() })).nullish();
const toolsRemovedSchema = z.array(z.looseObject({ name: z.string() })).nullish();

/**
 * pi-ai's `Message`, read loosely: the kit checks the shape it reads itself (`role`, the arrays of
 * `content` and the tool lists), so that nothing it reads can throw, and leaves the rest to pi-ai.
 */
const messageSchema = z.discriminatedUnion("role", [
  z.looseObject({ role: z.literal("user"), content: textOrBlocksSchema }),
  z.looseObject({ role: z.literal("assistant"), content: blocksSchema }),
  z.looseObject({ role: z.literal("toolResult"), content: blocksSchema }),
  z.looseObject({ role: z.literal("system"), content: textOrBlocksSchema, toolsAdded: toolsAddedSchema, toolsRemoved: toolsRemovedSchema }),
]);

/** pi-ai's `Context`, read loosely: the kit checks only what it relies on, and pi-ai the rest. */
const contextSchema = z.looseObject({
  systemPrompt: z.string().optional(),
  messages: z.array(messageSchema),
  tools: z.array(toolSchema).optional(),
});

const optionsSchema = z.strictObject({
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal, "must be an AbortSignal").optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.int().positive().optional(),
  reasoning: z.enum(THINKING_LEVELS).optional(),
  sessionId: z.string().optional(),
  maxRetries: z.int().nonnegative().optional(),
  toolChoice: z.enum(["auto", "none"]).optional(),
  documents: z.array(documentSchema).optional(),
  responseSchema: z
    .strictObject({
      name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "must be 1-64 letters, digits, _ or -"),
      schema: jsonSchemaObject,
    })
    .optional(),
});

/** A turn's options, validated: what every option means is in `ChatSchemaStreamOptions` and `ChatStreamOptions`. */
export interface TurnOptions {
  signal?: AbortSignal | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  reasoning?: (typeof THINKING_LEVELS)[number] | undefined;
  sessionId?: string | undefined;
  maxRetries?: number | undefined;
  toolChoice?: "auto" | "none" | undefined;
  documents?: readonly ChatDocument[] | undefined;
  responseSchema?: ChatResponseSchema | undefined;
}

/** Validates a turn's model reference, context and options; the error text names the first invalid fields. */
export function parseTurn(
  model: ChatModelRef,
  context: Context,
  options: TurnOptions | undefined,
): { ok: true; options: TurnOptions } | { ok: false; message: string } {
  const lines = [
    ...issueLinesOf(() => modelRefSchema.safeParse(model), "model"),
    ...issueLinesOf(() => contextSchema.safeParse(context), "context"),
    ...issueLinesOf(() => optionsSchema.safeParse(options ?? {}), "options"),
  ];
  return lines.length === 0 ? { ok: true, options: options ?? {} } : { ok: false, message: summarise(lines) };
}

/** The invalid fields of one input. An input that cannot be read at all (a getter or proxy that throws) is invalid too. */
function issueLinesOf(parse: () => z.ZodSafeParseResult<unknown>, prefix: string): string[] {
  try {
    const result = parse();
    return result.success ? [] : issueLines(result.error, prefix);
  } catch (error) {
    return [clip(`${prefix}: could not be read: ${errorText(error)}`)];
  }
}
