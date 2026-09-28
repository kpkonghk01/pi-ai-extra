import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  createOperationContext,
  isPiAiExtraError,
  parseDataUrl,
  parseRequest,
  PiAiExtraError,
  promptSchema,
  referenceImagesSchema,
  resolveReferenceImages,
  sniffImageMimeType,
  uploadInlineReferences,
  withErrorContext,
  type ImageProgressEvent,
} from "../src/index.ts";
import { dataUrl, GIF_BYTES, JPEG_BYTES, PNG_BYTES } from "../src/testing/fake-fetch.ts";

const ctx = (onProgress?: (event: ImageProgressEvent) => void) =>
  createOperationContext({ provider: "test", model: "model-a", onProgress });

describe("PiAiExtraError", () => {
  it("prefixes provider/model and serializes without losing context", () => {
    const error = new PiAiExtraError("boom", { provider: "kie", model: "nano-banana-2", code: "http", status: 500, retryable: true });
    assert.equal(error.message, "[kie/nano-banana-2] boom");
    assert.equal(isPiAiExtraError(error), true);
    assert.deepEqual(
      { provider: error.toJSON().provider, model: error.toJSON().model, code: error.toJSON().code, status: error.toJSON().status },
      { provider: "kie", model: "nano-banana-2", code: "http", status: 500 },
    );
  });

  it("is recognised across bundled copies by brand, not class identity", () => {
    const foreign = Object.assign(new Error("x"), { isPiAiExtraError: true });
    assert.equal(isPiAiExtraError(foreign), true);
    assert.equal(isPiAiExtraError(new Error("x")), false);
  });

  it("adds context without double-prefixing the message", () => {
    const error = new PiAiExtraError("failed", { provider: "toapis", model: "gpt-image-2", code: "task_failed" });
    const enriched = withErrorContext(error, { taskId: "task_1" });
    assert.equal(enriched.message, "[toapis/gpt-image-2] failed");
    assert.equal(enriched.taskId, "task_1");
  });
});

describe("image data", () => {
  it("parses base64 data URLs and rejects malformed ones", () => {
    assert.deepEqual(parseDataUrl("data:image/png;base64,AAAA"), { declaredMimeType: "image/png", base64: "AAAA" });
    assert.equal(parseDataUrl("data:image/png,plain"), undefined);
    assert.equal(parseDataUrl("data:image/png;base64,***"), undefined);
    assert.equal(parseDataUrl("https://example.com/a.png"), undefined);
  });

  it("sniffs formats from magic bytes", () => {
    assert.equal(sniffImageMimeType(PNG_BYTES), "image/png");
    assert.equal(sniffImageMimeType(JPEG_BYTES), "image/jpeg");
    assert.equal(sniffImageMimeType(GIF_BYTES), "image/gif");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    assert.equal(sniffImageMimeType(webp), "image/webp");
    assert.equal(sniffImageMimeType(new TextEncoder().encode("<html>")), undefined);
  });
});

describe("request validation", () => {
  const schema = z.strictObject({
    prompt: promptSchema(10),
    referenceImages: referenceImagesSchema("model-a", { min: 1, max: 2 }),
  });

  it("reports reference-count violations as reference_limit, never trimming", () => {
    assert.throws(
      () => parseRequest(ctx(), schema, { prompt: "hi", referenceImages: ["a", "b", "c"] }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "reference_limit" && /at most 2/.test(error.message),
    );
    assert.throws(
      () => parseRequest(ctx(), schema, { prompt: "hi" }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "reference_limit" && /at least 1/.test(error.message),
    );
  });

  it("reports other schema violations as invalid_request, including unknown keys", () => {
    assert.throws(
      () => parseRequest(ctx(), schema, { prompt: "", referenceImages: ["a"] }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "invalid_request",
    );
    assert.throws(
      () => parseRequest(ctx(), schema, { prompt: "hi", referenceImages: ["a"], aspect_ratio: "1:1" }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "invalid_request" && /aspect_ratio/.test(error.message),
    );
  });

  it("rejects any reference for text-only operations", () => {
    const textOnly = z.strictObject({ referenceImages: referenceImagesSchema("t2i", { min: 0, max: 0 }) });
    assert.throws(
      () => parseRequest(ctx(), textOnly, { referenceImages: ["https://example.com/a.png"] }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "reference_limit" && /does not accept/.test(error.message),
    );
  });
});

describe("reference images", () => {
  const policy = { acceptedMimeTypes: ["image/png", "image/jpeg"] as const, maxInlineBytes: 1024 };

  it("passes URLs through and validates inline images by magic bytes", () => {
    const resolved = resolveReferenceImages(ctx(), ["https://cdn.example.com/a.png", dataUrl(PNG_BYTES, "image/jpeg")], policy);
    assert.deepEqual(resolved[0], { kind: "url", index: 0, url: "https://cdn.example.com/a.png" });
    assert.equal(resolved[1]?.kind, "inline");
    assert.equal(resolved[1]?.kind === "inline" ? resolved[1].mimeType : undefined, "image/png");
  });

  it("rejects unsupported, oversize and non-image inline data", () => {
    const reject = (value: string, pattern: RegExp) =>
      assert.throws(
        () => resolveReferenceImages(ctx(), [value], policy),
        (error: unknown) => isPiAiExtraError(error) && error.code === "invalid_reference" && pattern.test(error.message),
      );
    reject(dataUrl(GIF_BYTES, "image/gif"), /image\/gif; accepted/);
    reject(dataUrl(new Uint8Array(2048).fill(0xff), "image/jpeg"), /limit for inline images/);
    reject(dataUrl(new TextEncoder().encode("hello"), "image/png"), /not a PNG/);
    reject("ftp://example.com/a.png", /data URL or an http\(s\) URL/);
  });

  it("uploads inline images concurrently but returns URLs in the original order", async () => {
    const events: ImageProgressEvent[] = [];
    const resolved = resolveReferenceImages(
      ctx(),
      [dataUrl(PNG_BYTES, "image/png"), "https://cdn.example.com/b.png", dataUrl(JPEG_BYTES, "image/jpeg")],
      policy,
    );
    const urls = await uploadInlineReferences(ctx((event) => events.push(event)), resolved, async (reference) => {
      await new Promise((resolve) => setTimeout(resolve, reference.index === 0 ? 20 : 1));
      return `https://uploads.example.com/${reference.index}`;
    });
    assert.deepEqual(urls, ["https://uploads.example.com/0", "https://cdn.example.com/b.png", "https://uploads.example.com/2"]);
    assert.equal(events.filter((event) => event.type === "upload_completed").length, 2);
  });

  it("fails the whole request when any upload fails", async () => {
    const resolved = resolveReferenceImages(ctx(), [dataUrl(PNG_BYTES, "image/png"), dataUrl(PNG_BYTES, "image/png")], policy);
    await assert.rejects(
      uploadInlineReferences(ctx(), resolved, async (reference) => {
        if (reference.index === 1) throw new PiAiExtraError("upload down", { provider: "test", model: "model-a", code: "upload_failed" });
        return "https://uploads.example.com/0";
      }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "upload_failed",
    );
  });
});
