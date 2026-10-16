import { z } from "zod";
import type { ChatKitOptions, ChatProviderConfig, ChatTurnInput } from "./types.ts";

const PROVIDER_KINDS = ["google", "openrouter", "kie", "toapis"] as const;
const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

const nonEmpty = z.string().refine((value) => value.trim().length > 0, "must not be empty");

const providerConfigSchema = z.strictObject({
  name: nonEmpty,
  provider: z.enum(PROVIDER_KINDS, {
    error: (issue) => `unknown provider ${JSON.stringify(issue.input)}; expected one of ${PROVIDER_KINDS.join(", ")}`,
  }),
  apiKey: nonEmpty,
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
  grounding: z.boolean().optional(),
});

const kitOptionsSchema = z.strictObject({
  providers: z.array(z.unknown()),
  fetch: z.custom<typeof globalThis.fetch>((value) => typeof value === "function", "must be a function").optional(),
});

function formatIssues(error: z.ZodError, prefix: string): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`)).join("");
      return `${prefix}${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Validates the kit configuration. An unknown provider, a duplicate name, a missing key or
 * grounding on a provider other than Google throws a `TypeError` here, before any turn runs.
 */
export function parseKitOptions(options: ChatKitOptions): { providers: ChatProviderConfig[]; fetch: typeof globalThis.fetch | undefined } {
  const parsed = kitOptionsSchema.safeParse(options);
  if (!parsed.success) throw new TypeError(`chat-kit: invalid options: ${formatIssues(parsed.error, "options")}`);
  const providers: ChatProviderConfig[] = [];
  const names = new Set<string>();
  parsed.data.providers.forEach((candidate, index) => {
    const config = providerConfigSchema.safeParse(candidate);
    if (!config.success) throw new TypeError(`chat-kit: invalid provider config: ${formatIssues(config.error, `providers[${index}]`)}`);
    const { name, provider, grounding } = config.data;
    if (names.has(name)) throw new TypeError(`chat-kit: duplicate provider name ${JSON.stringify(name)}; each name must be unique.`);
    if (grounding === true && provider !== "google") {
      throw new TypeError(`chat-kit: providers[${index}] (${JSON.stringify(name)}): grounding is supported only for provider "google".`);
    }
    names.add(name);
    providers.push(config.data);
  });
  return { providers, fetch: parsed.data.fetch };
}

const documentSchema = z.looseObject({
  name: nonEmpty,
  mimeType: nonEmpty,
  url: z.url({ protocol: /^https?$/ }).optional(),
  size: z.int().nonnegative().optional(),
  load: z.custom<() => Promise<Uint8Array>>((value) => typeof value === "function", "must be a function"),
});

const turnInputSchema = z.strictObject({
  provider: nonEmpty,
  model: nonEmpty,
  systemPrompt: z.string(),
  documents: z.array(documentSchema),
  history: z.array(z.looseObject({ role: z.enum(["user", "assistant"]), text: z.string() })),
  message: z.string(),
  responseSchema: z
    .strictObject({
      name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "must be 1-64 letters, digits, _ or -"),
      schema: z.custom<object>(
        (value) => typeof value === "object" && value !== null && !Array.isArray(value),
        "must be a JSON Schema object",
      ),
    })
    .optional(),
  settings: z
    .strictObject({
      temperature: z.number().min(0).max(2).optional(),
      maxOutputTokens: z.int().positive().optional(),
      reasoning: z.enum(THINKING_LEVELS).optional(),
    })
    .optional(),
});

/** Validates a turn input; the error text names every invalid field. */
export function parseTurnInput(input: ChatTurnInput): { ok: true } | { ok: false; message: string } {
  const parsed = turnInputSchema.safeParse(input);
  return parsed.success ? { ok: true } : { ok: false, message: formatIssues(parsed.error, "input") };
}
