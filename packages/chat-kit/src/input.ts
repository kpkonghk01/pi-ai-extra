// pi-ai's own list of thinking levels, from which its `ThinkingLevel` type is derived. It is
// exported only from this subpath, not from the package root.
import { THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import type { Context } from "@earendil-works/pi-ai";
import type { ChatProvider } from "@hk01/pi-ai-extra-internal/pi-ai";
import { z } from "zod";
import { errorText } from "./errors.ts";
import { assertChatProvider } from "./registry.ts";
import type { ChatDocument, ChatKitOptions, ChatModelRef, ChatResponseSchema } from "./types.ts";

const nonEmpty = z.string().refine((value) => value.trim().length > 0, "must not be empty");

const kitOptionsSchema = z.strictObject({
  providers: z.array(z.unknown()),
  fetch: z.custom<typeof globalThis.fetch>((value) => typeof value === "function", "must be a function").optional(),
});

/** More invalid fields than this are summarised, so that the message stays short for a context of thousands of bad messages. */
const MAX_LISTED_ISSUES = 10;

function formatIssues(error: z.ZodError, prefix: string): string {
  const listed = error.issues.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const path = issue.path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`)).join("");
    return `${prefix}${path}: ${issue.message}`;
  });
  const more = error.issues.length - listed.length;
  return (more > 0 ? [...listed, `${prefix}: and ${more} more`] : listed).join("; ");
}

/**
 * Validates the kit options. Anything that is not a chat provider throws a `TypeError` here,
 * before any turn runs; so does a duplicate provider id (`createProviderRegistry`).
 */
export function parseKitOptions(options: ChatKitOptions): { providers: ChatProvider[]; fetch: typeof globalThis.fetch | undefined } {
  const parsed = kitOptionsSchema.safeParse(options);
  if (!parsed.success) throw new TypeError(`chat-kit: invalid options: ${formatIssues(parsed.error, "options")}`);
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
 * Message content as pi-ai's `Message` types it. A missing one (`null` or `undefined`) is invalid:
 * pi-ai 1.2.0's `transformMessages` would read it as empty, but its token estimate, which
 * runs first on the context as given, throws on it.
 */
const blocksSchema = z.array(blockSchema);
const textOrBlocksSchema = z.union([z.string(), z.array(blockSchema)]);

/** The tools a system message adds or removes: the kit reads their names. pi-ai reads a missing list (`null` too) as empty. */
const toolRefsSchema = z.array(z.looseObject({ name: z.string() })).nullish();

/**
 * pi-ai's `Message`, read loosely: the kit checks the shape it reads itself (`role`, the arrays of
 * `content` and the tool lists), so that nothing it reads can throw, and leaves the rest to pi-ai.
 */
const messageSchema = z.discriminatedUnion("role", [
  z.looseObject({ role: z.literal("user"), content: textOrBlocksSchema }),
  z.looseObject({ role: z.literal("assistant"), content: blocksSchema }),
  z.looseObject({ role: z.literal("toolResult"), content: blocksSchema }),
  z.looseObject({ role: z.literal("system"), content: textOrBlocksSchema, toolsAdded: toolRefsSchema, toolsRemoved: toolRefsSchema }),
]);

/** A plain JSON object: the kit hands it to pi-ai and the provider as JSON, so a cyclic one, or one holding a BigInt, is invalid. */
function jsonObject(message: string) {
  return z.custom<object>((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    try {
      JSON.stringify(value);
      return true;
    } catch {
      return false;
    }
  }, message);
}

/** pi-ai's `Context`, read loosely: the kit checks only what it relies on, and pi-ai the rest. */
const contextSchema = z.looseObject({
  systemPrompt: z.string().optional(),
  messages: z.array(messageSchema),
  tools: z
    .array(z.looseObject({ name: nonEmpty, description: z.string(), parameters: jsonObject("must be a JSON Schema object") }))
    .optional(),
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
      schema: jsonObject("must be a JSON Schema object"),
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

/** Validates a turn's model reference, context and options; the error text names every invalid field. */
export function parseTurn(
  model: ChatModelRef,
  context: Context,
  options: TurnOptions | undefined,
): { ok: true; options: TurnOptions } | { ok: false; message: string } {
  const issues = [
    issuesOf(() => modelRefSchema.safeParse(model), "model"),
    issuesOf(() => contextSchema.safeParse(context), "context"),
    issuesOf(() => optionsSchema.safeParse(options ?? {}), "options"),
  ].filter((issue) => issue !== undefined);
  return issues.length === 0 ? { ok: true, options: options ?? {} } : { ok: false, message: issues.join("; ") };
}

/** The invalid fields of one input, or `undefined`. An input that cannot be read at all (a getter or proxy that throws) is invalid too. */
function issuesOf(parse: () => z.ZodSafeParseResult<unknown>, prefix: string): string | undefined {
  try {
    const result = parse();
    return result.success ? undefined : formatIssues(result.error, prefix);
  } catch (error) {
    return `${prefix}: could not be read: ${errorText(error)}`;
  }
}
