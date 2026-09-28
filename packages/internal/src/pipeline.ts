import { z } from "zod";
import { throwIfAborted } from "./abort.ts";
import { emitProgress, type OperationContext } from "./context.ts";
import { downloadResultImages } from "./download.ts";
import type { PollSchedule } from "./poll.ts";
import { uploadInlineReferences, type InlineReference, type ResolvedReference } from "./references.ts";
import { completeResult, DEFAULT_MAX_OUTPUT_BYTES, type ImageGenerationResult } from "./result.ts";
import { DOWNLOAD_RETRY } from "./retry.ts";
import type { ImageUsage } from "./usage.ts";

const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Validation for the transport settings every asynchronous (task-based) helper accepts. */
export const taskSettingsShape: {
  poll: z.ZodOptional<z.ZodObject<{ initialDelayMs: z.ZodOptional<z.ZodNumber>; maxDelayMs: z.ZodOptional<z.ZodNumber> }, z.core.$strict>>;
  timeoutMs: z.ZodOptional<z.ZodNumber>;
  maxOutputBytes: z.ZodOptional<z.ZodNumber>;
} = {
  poll: z
    .strictObject({ initialDelayMs: z.number().int().positive().optional(), maxDelayMs: z.number().int().positive().optional() })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
};

export const httpUrlSchema: z.ZodURL = z.url({ protocol: /^https?$/ });

export interface PollDefaults {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitterRatio: number;
  timeoutMs: number;
}

/** Applies caller overrides (`poll`, `timeoutMs`) to a provider's documented polling cadence. */
export function pollSchedule(
  defaults: PollDefaults,
  overrides: { poll?: { initialDelayMs?: number | undefined; maxDelayMs?: number | undefined } | undefined; timeoutMs?: number | undefined },
): PollSchedule {
  const initialDelayMs = overrides.poll?.initialDelayMs ?? defaults.initialDelayMs;
  return {
    initialDelayMs,
    maxDelayMs: Math.max(initialDelayMs, overrides.poll?.maxDelayMs ?? defaults.maxDelayMs),
    factor: defaults.factor,
    jitterRatio: defaults.jitterRatio,
    timeoutMs: overrides.timeoutMs ?? defaults.timeoutMs,
  };
}

export interface AsyncImageTask {
  references: readonly ResolvedReference[];
  /** Same-provider upload of one inline reference; returns its provider URL. */
  upload: (reference: InlineReference) => Promise<string>;
  /** Creates the provider task once (never retried) and returns its id. */
  submit: (imageUrls: string[]) => Promise<string>;
  /** Polls the same task to a terminal state. */
  wait: (taskId: string) => Promise<{ resultUrls: string[]; usage: ImageUsage | undefined }>;
  maxOutputBytes: number | undefined;
}

/** Shared upload → submit → poll → download flow of the task-based providers (KIE, ToAPIs). */
export async function runAsyncImageTask(ctx: OperationContext, task: AsyncImageTask): Promise<ImageGenerationResult> {
  const imageUrls = await uploadInlineReferences(ctx, task.references, task.upload);
  throwIfAborted(ctx, "submit");
  const taskId = await task.submit(imageUrls);
  emitProgress(ctx, { type: "task_submitted", taskId });
  const { resultUrls, usage } = await task.wait(taskId);
  const images = await downloadResultImages(ctx, resultUrls, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: task.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    retry: DOWNLOAD_RETRY,
    taskId,
  });
  return completeResult(ctx, taskId, images, usage);
}
