import { z } from "zod";
import { emitProgress, type OperationContext } from "./context.ts";
import { formatZodIssues } from "./validation.ts";

export type BillingStatus = "pending" | "settled" | "refunded";

/**
 * Provider-reported token counts. A field is present only when the provider returned
 * it; nothing is estimated and missing values are never filled with 0.
 */
export interface ImageTokenUsage {
  /** Total input tokens, including cached ones (ToAPIs `input_tokens`, Gemini `promptTokenCount`). */
  input?: number;
  /** Output tokens, excluding `reasoning` (ToAPIs `output_tokens`, Gemini `candidatesTokenCount`). */
  output?: number;
  /** Provider-reported total (ToAPIs `total_tokens`, Gemini `totalTokenCount`). */
  total?: number;
  inputText?: number;
  inputImage?: number;
  /** Cached subset of `input` (ToAPIs `cached_tokens`, Gemini `cachedContentTokenCount`). */
  cachedInput?: number;
  cachedInputText?: number;
  cachedInputImage?: number;
  outputText?: number;
  outputImage?: number;
  /** Thinking tokens reported separately from `output` (Gemini `thoughtsTokenCount`). */
  reasoning?: number;
  /** Gemini `toolUsePromptTokenCount`. */
  toolUsePrompt?: number;
}

/**
 * Usage and billing data exactly as the provider reported it for one task or request.
 * Consumers that record spend should de-duplicate by task id and prefer the latest
 * settled record (see `getToapisTask` / `getKieTask`) instead of summing observations.
 */
export interface ImageUsage {
  /**
   * Credits charged. KIE reports a number (`creditsConsumed`); ToAPIs reports a
   * decimal string (`billing.credits`), which is kept as a string to avoid rounding.
   */
  credits?: number | string;
  /** USD charged as a decimal string (ToAPIs `billing.cost_usd`). */
  costUsd?: string;
  /** ToAPIs settlement state. `pending` amounts may still change or be refunded. */
  billingStatus?: BillingStatus;
  tokens?: ImageTokenUsage;
  /** Provider-side processing time in milliseconds (KIE `costTime`). */
  providerDurationMs?: number;
}

export interface ImageUsageInput {
  credits?: number | string | null | undefined;
  costUsd?: string | null | undefined;
  billingStatus?: BillingStatus | null | undefined;
  tokens?: { [K in keyof ImageTokenUsage]?: number | null | undefined } | undefined;
  providerDurationMs?: number | null | undefined;
}

/** Non-negative decimal string, as ToAPIs documents for billing amounts. */
export const decimalStringSchema: z.ZodString = z.string().regex(/^\d+(\.\d+)?$/, "expected a non-negative decimal string");
export const tokenCountSchema: z.ZodNumber = z.number().int().nonnegative();

/** Builds an `ImageUsage`, omitting absent fields; returns undefined when nothing was reported. */
export function compactUsage(input: ImageUsageInput): ImageUsage | undefined {
  const tokens = omitNullish(input.tokens ?? {});
  const usage: ImageUsage = {
    ...omitNullish({
      credits: input.credits,
      costUsd: input.costUsd,
      billingStatus: input.billingStatus,
      providerDurationMs: input.providerDurationMs,
    }),
    ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/**
 * Validates an optional usage/billing block. Invalid data is omitted and reported as a
 * `warning` progress event: a finished (and billed) image is never discarded because
 * its accounting metadata changed shape.
 */
export function parseUsageBlock<T>(ctx: OperationContext, schema: z.ZodType<T>, value: unknown, label: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  emitProgress(ctx, { type: "warning", message: `${label} omitted from usage: ${formatZodIssues(parsed.error)}` });
  return undefined;
}

/** Copy without null/undefined values: reported-but-absent counters stay absent, never 0. */
function omitNullish<T extends Record<string, unknown>>(input: T): { [K in keyof T]?: Exclude<T[K], null | undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], null | undefined>;
  };
}
