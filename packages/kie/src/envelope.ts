import { z } from "zod";
import { codeForStatus, contextError, safeStringify, truncate, type OperationContext } from "@hk01/pi-ai-extra-internal";

/** KIE wraps every response in `{ code, msg, data }`; `code` is authoritative even when HTTP is 200. */
export function envelope<T extends z.ZodType>(
  data: T,
): z.ZodObject<{ code: z.ZodNumber; msg: z.ZodOptional<z.ZodNullable<z.ZodString>>; data: z.ZodOptional<z.ZodNullable<T>> }> {
  return z.object({ code: z.number(), msg: z.string().nullish(), data: data.nullish() });
}

export function envelopeData<T>(
  ctx: OperationContext,
  response: { code: number; msg?: string | null | undefined; data?: T | null | undefined },
  operation: "upload" | "submit" | "poll",
  label: string,
  taskId?: string,
): T {
  if (response.code === 200 && response.data) return response.data;
  const code = response.code === 200 ? "invalid_response" : codeForStatus(response.code);
  throw contextError(ctx, `${label} failed with KIE code ${response.code}: ${response.msg?.trim() || "no message"}.`, {
    code: operation === "upload" && code === "http" ? "upload_failed" : code,
    operation,
    taskId,
    providerCode: String(response.code),
    retryable: response.code === 429 || response.code >= 500,
    responseBody: truncate(safeStringify(response)),
  });
}

export function bearerHeaders(apiKey: string, json: boolean = false): Record<string, string> {
  return json ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } : { Authorization: `Bearer ${apiKey}` };
}
