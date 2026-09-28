import { z } from "zod";
import { fileExtension, requestJson, type InlineReference, type OperationContext, type RetryPolicy } from "@hk01/pi-ai-extra-internal";
import { bearerHeaders, envelope, envelopeData } from "./envelope.ts";

export interface KieEndpoints {
  apiBaseUrl: string;
  uploadBaseUrl: string;
}

const UPLOAD_TIMEOUT_MS = 60_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const UPLOAD_RETRY: RetryPolicy = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000 };

const uploadResponse = envelope(z.object({ downloadUrl: z.url() }));
const createTaskResponse = envelope(z.object({ taskId: z.string().min(1) }));

/** Uploads one inline reference through KIE's base64 File Upload API and returns its URL. */
export async function uploadToKie(
  ctx: OperationContext,
  apiKey: string,
  endpoints: KieEndpoints,
  reference: InlineReference,
): Promise<string> {
  const body = JSON.stringify({
    base64Data: `data:${reference.mimeType};base64,${reference.base64}`,
    uploadPath: "pi-ai-extra/references",
    fileName: `ref-${Date.now()}-${reference.index}-${Math.random().toString(36).slice(2, 10)}.${fileExtension(reference.mimeType)}`,
  });
  const response = await requestJson(
    ctx,
    {
      url: `${endpoints.uploadBaseUrl}/api/file-base64-upload`,
      method: "POST",
      headers: bearerHeaders(apiKey, true),
      body,
      operation: "upload",
      timeoutMs: UPLOAD_TIMEOUT_MS,
      retry: UPLOAD_RETRY,
    },
    uploadResponse,
  );
  return envelopeData(ctx, response, "upload", `referenceImages[${reference.index}] upload`).downloadUrl;
}

/** Creates a KIE market task. Never retried automatically: a repeated submission could be billed twice. */
export async function createKieTask(
  ctx: OperationContext,
  apiKey: string,
  endpoints: KieEndpoints,
  model: string,
  input: Record<string, unknown>,
): Promise<string> {
  const response = await requestJson(
    ctx,
    {
      url: `${endpoints.apiBaseUrl}/api/v1/jobs/createTask`,
      method: "POST",
      headers: bearerHeaders(apiKey, true),
      body: JSON.stringify({ model, input }),
      operation: "submit",
      timeoutMs: SUBMIT_TIMEOUT_MS,
    },
    createTaskResponse,
  );
  return envelopeData(ctx, response, "submit", "createTask").taskId;
}
