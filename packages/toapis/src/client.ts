import { z } from "zod";
import {
  contextError,
  fileExtension,
  requestJson,
  safeStringify,
  truncate,
  UPLOAD_RETRY,
  type InlineReference,
  type OperationContext,
} from "@hk01/pi-ai-extra-internal";

const UPLOAD_TIMEOUT_MS = 60_000;
const SUBMIT_TIMEOUT_MS = 60_000;

const uploadResponse = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.object({ url: z.url() }).nullish(),
});

/** The submit response carries the task id as `id` (some examples show `task_id`). */
const submitResponse = z
  .object({ id: z.string().min(1).optional(), task_id: z.string().min(1).optional() })
  .transform((body, ctx) => {
    const taskId = body.id ?? body.task_id;
    if (taskId === undefined) ctx.addIssue({ code: "custom", message: "missing task id (id or task_id)" });
    return taskId ?? "";
  });

/** Uploads one inline reference through ToAPIs `/v1/uploads/images` and returns its public URL. */
export async function uploadToToapis(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  reference: InlineReference,
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType });
  form.append("file", blob, `reference-${reference.index}.${fileExtension(reference.mimeType)}`);
  const response = await requestJson(
    ctx,
    {
      url: `${baseUrl}/v1/uploads/images`,
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      operation: "upload",
      timeoutMs: UPLOAD_TIMEOUT_MS,
      retry: UPLOAD_RETRY,
    },
    uploadResponse,
  );
  if (response.success && response.data) return response.data.url;
  throw contextError(ctx, `referenceImages[${reference.index}] upload failed: ${response.message?.trim() || "no message"}.`, {
    code: "upload_failed",
    operation: "upload",
    responseBody: truncate(safeStringify(response)),
  });
}

/** Creates an image generation task. Never retried automatically: a repeated submission could be billed twice. */
export async function createToapisTask(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await requestJson(
    ctx,
    {
      url: `${baseUrl}/v1/images/generations`,
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      operation: "submit",
      timeoutMs: SUBMIT_TIMEOUT_MS,
    },
    submitResponse,
  );
  return response;
}
