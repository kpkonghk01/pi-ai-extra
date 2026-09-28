import { z } from "zod";
import { contextError, type OperationContext } from "./context.ts";

const REFERENCE_LIMIT_MARKER = "pi-ai-extra/reference-limit";

export interface ReferenceImageLimit {
  min: number;
  /** `null` means the provider documents no limit, so the package does not impose one. */
  max: number | null;
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Schema for a model operation's `referenceImages`. Count violations are tagged so
 * `parseRequest` reports them as `reference_limit` errors; images are never dropped.
 */
export function referenceImagesSchema(modelId: string, limit: ReferenceImageLimit): z.ZodType<string[]> {
  return z
    .array(z.string().min(1, "reference image must be a non-empty data URL or http(s) URL"))
    .default([])
    .superRefine((images, ctx) => {
      const message = referenceLimitMessage(modelId, limit, images.length);
      if (message) ctx.addIssue({ code: "custom", message, params: { marker: REFERENCE_LIMIT_MARKER } });
    });
}

export function referenceLimitMessage(modelId: string, limit: ReferenceImageLimit, count: number): string | undefined {
  if (limit.max === 0 && count > 0) {
    return `${modelId} does not accept reference images (received ${count}).`;
  }
  if (count < limit.min) {
    return `${modelId} requires at least ${limit.min} reference image(s) (received ${count}).`;
  }
  if (limit.max !== null && count > limit.max) {
    return `${modelId} accepts at most ${limit.max} reference image(s) (received ${count}); images are never dropped automatically.`;
  }
  return undefined;
}

export function promptSchema(maxLength: number | null): z.ZodString {
  const base = z.string().trim().min(1, "prompt must not be empty");
  return maxLength === null ? base : base.max(maxLength, `prompt must be at most ${maxLength} characters`);
}

/** Validates a request payload, mapping reference-count violations to `reference_limit`. */
export function parseRequest<T>(ctx: OperationContext, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  const isReferenceLimit = parsed.error.issues.some(
    (issue) => issue.code === "custom" && (issue.params as { marker?: unknown } | undefined)?.marker === REFERENCE_LIMIT_MARKER,
  );
  throw contextError(ctx, `Invalid request: ${formatZodIssues(parsed.error)}`, {
    code: isReferenceLimit ? "reference_limit" : "invalid_request",
    operation: "validate",
  });
}

export function assertApiKey(ctx: OperationContext, apiKey: unknown): asserts apiKey is string {
  if (typeof apiKey === "string" && apiKey.trim()) return;
  throw contextError(ctx, "apiKey is required and must be passed explicitly from server-side configuration.", {
    code: "invalid_request",
    operation: "validate",
  });
}

export function assertSupportedModel(ctx: OperationContext, model: unknown, supported: readonly string[]): void {
  if (typeof model === "string" && supported.includes(model)) return;
  throw contextError(ctx, `Unsupported model ${JSON.stringify(model)}. Supported models: ${supported.join(", ")}.`, {
    code: "invalid_request",
    operation: "validate",
  });
}

/** The `model`, `prompt` and `referenceImages` fields every image operation validates, derived from its catalogue entry. */
export function baseRequestShape(info: {
  id: string;
  promptMaxLength: number | null;
  referenceImages: ReferenceImageLimit;
}): { model: z.ZodLiteral<string>; prompt: z.ZodString; referenceImages: z.ZodType<string[]> } {
  return {
    model: z.literal(info.id),
    prompt: promptSchema(info.promptMaxLength),
    referenceImages: referenceImagesSchema(info.id, info.referenceImages),
  };
}
