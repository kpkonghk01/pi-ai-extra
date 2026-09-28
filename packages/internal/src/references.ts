import { throwIfAborted } from "./abort.ts";
import { contextError, emitProgress, type OperationContext } from "./context.ts";
import {
  decodeBase64,
  formatBytes,
  parseDataUrl,
  sniffImageMimeType,
  type ImageMimeType,
} from "./image-data.ts";

export interface ReferenceImagePolicy {
  acceptedMimeTypes: readonly ImageMimeType[];
  /** Largest inline (data URL) image accepted, in decoded bytes. */
  maxInlineBytes: number;
}

export type ResolvedReference =
  | { kind: "url"; index: number; url: string }
  | { kind: "inline"; index: number; mimeType: ImageMimeType; bytes: Uint8Array; base64: string };

export type InlineReference = Extract<ResolvedReference, { kind: "inline" }>;

/**
 * Classifies each reference image as a public URL (passed through unchanged) or an
 * inline data URL (validated by magic bytes, type and size before any upload).
 */
export function resolveReferenceImages(
  ctx: OperationContext,
  images: readonly string[],
  policy: ReferenceImagePolicy,
): ResolvedReference[] {
  return images.map((value, index) => resolveOne(ctx, value, index, policy));
}

/**
 * Uploads inline references through the given same-provider uploader and returns
 * provider URLs in the original order. URL references are returned unchanged.
 */
export async function uploadInlineReferences(
  ctx: OperationContext,
  references: readonly ResolvedReference[],
  upload: (reference: InlineReference) => Promise<string>,
  concurrency: number = 3,
): Promise<string[]> {
  const urls = new Array<string>(references.length);
  const inline = references.filter((reference): reference is InlineReference => reference.kind === "inline");
  for (const reference of references) {
    if (reference.kind === "url") urls[reference.index] = reference.url;
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < inline.length) {
      const reference = inline[next];
      next += 1;
      if (!reference) continue;
      throwIfAborted(ctx, "upload");
      emitProgress(ctx, { type: "upload_started", index: reference.index, total: references.length });
      const url = await upload(reference);
      urls[reference.index] = url;
      emitProgress(ctx, { type: "upload_completed", index: reference.index, total: references.length, url });
    }
  };
  // Any failed upload rejects the whole call: a request never proceeds with fewer images than supplied.
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), inline.length) }, () => worker()));
  return urls;
}

function resolveOne(ctx: OperationContext, value: string, index: number, policy: ReferenceImagePolicy): ResolvedReference {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    if (!URL.canParse(trimmed)) throw invalidReference(ctx, index, "is not a valid URL");
    return { kind: "url", index, url: trimmed };
  }
  if (!/^data:/i.test(trimmed)) {
    throw invalidReference(ctx, index, "must be a base64 data URL or an http(s) URL");
  }

  const parsed = parseDataUrl(trimmed);
  if (!parsed) throw invalidReference(ctx, index, "is not a valid base64 data URL");
  const bytes = decodeBase64(parsed.base64);
  if (bytes.byteLength > policy.maxInlineBytes) {
    throw invalidReference(
      ctx,
      index,
      `is ${formatBytes(bytes.byteLength)}; the limit for inline images is ${formatBytes(policy.maxInlineBytes)}`,
    );
  }
  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) throw invalidReference(ctx, index, "is not a PNG, JPEG, WebP or GIF image");
  if (!policy.acceptedMimeTypes.includes(mimeType)) {
    throw invalidReference(ctx, index, `is ${mimeType}; accepted types: ${policy.acceptedMimeTypes.join(", ")}`);
  }
  return { kind: "inline", index, mimeType, bytes, base64: parsed.base64 };
}

function invalidReference(ctx: OperationContext, index: number, reason: string) {
  return contextError(ctx, `referenceImages[${index}] ${reason}.`, { code: "invalid_reference", operation: "validate" });
}
