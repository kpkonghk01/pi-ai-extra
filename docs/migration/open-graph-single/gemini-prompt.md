# Task: migrate this app's image providers to the `@hk01/pi-ai-extra-*` packages

You are editing this Google AI Studio app (React + Vite client, Express `server.ts`). Replace the hand-written KIE, ToAPIs and Gemini image-generation code with three published server-only packages. Keep every prompt text exactly as it is today, and keep all unrelated features unchanged: Firebase, history, canvas post-processing (`processFinalImage`), layout and styling.

## Non-negotiable rules

1. **No fallback of any kind.** Each request uses exactly one provider and one model: the one the user selected. Delete all of the following, and do not add new versions of them:
   - the KIE candidate model lists that try several model names in turn;
   - the ToAPIs host loops (`toapis.com` / `api.toapis.cn` / `api.toapis.com`);
   - uploading ToAPIs reference images to KIE storage when ToAPIs upload fails;
   - switching `gpt-image-2.5-*` to `gpt-image-2` on "circuit broken";
   - slicing, filtering or silently dropping reference images (`.slice(0, 10)`, `.slice(0, 5)`, `.filter(Boolean)` after failed uploads);
   - the ToAPIs "safety blocked → retry with a simplified prompt" re-run;
   - Wokey models being routed to Gemini or KIE;
   - automatic client-side retries (`maxAttempts = 2` in `src/lib/gemini.ts`). Every retry creates a new billed task and hides the first error.
2. **Every failure must reach the UI, explicitly and completely**, so users can report it. The UI must show:
   - the provider;
   - the model actually used;
   - the error code;
   - the HTTP status and task id when known;
   - the message.

   The error must stay on screen until the user closes it and must have a "複製錯誤資訊" (copy error details) button. Do not replace errors with generic text, and do not swallow them. The only exception is user cancellation (`USER_CANCELLED`), which stays silent as today.
3. **API keys stay on the server.** Read `KIE_API_KEY`, `TOAPIS_API_KEY` and `GEMINI_API_KEY` from `process.env` in server code only, and pass them explicitly to the packages. Never send them to the browser.
4. **Do not change the `build` or `start` scripts.** The server is built as ESM (`esbuild --format=esm … --outfile=dist/server.mjs`, `"start": "node dist/server.mjs"`). For image generation, import only the packages' main entries (`@hk01/pi-ai-extra-kie`, `@hk01/pi-ai-extra-toapis`, `@hk01/pi-ai-extra-google`); the `/pi-ai` subpaths are not needed for this task.
5. Do not invent package APIs. Use only what `server/providers/imageClient.ts` (below) uses.

## Step 1: dependencies

Add these three entries to `dependencies` in `package.json`. Leave everything else unchanged.

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.1.0/hk01-pi-ai-extra-google-0.1.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
```

## Step 2: create `server/providers/imageClient.ts`

Create this file with exactly this content. It is the only place that calls the packages. It handles:
- mapping the app's model ids to provider operations;
- mapping ratio presets to each model's supported ratios;
- reading the keys;
- giving ToAPIs requests a unique `clientBusinessId`;
- usage logging;
- turning package errors into `AppImageError`, which carries UI-ready `details`.

```ts
import { randomUUID } from "node:crypto";
import {
  generateKieImage,
  isPiAiExtraError,
  KIE_IMAGE_MODELS,
  type ImageGenerationResult,
  type ImageModelInfo,
  type KieImageRequest,
} from "@hk01/pi-ai-extra-kie";
import { generateToapisImage, TOAPIS_IMAGE_MODELS, type ToapisImageRequest } from "@hk01/pi-ai-extra-toapis";
import { generateGoogleImage, GOOGLE_IMAGE_MODELS, type GoogleImageRequest } from "@hk01/pi-ai-extra-google";

/**
 * The only place this app talks to image providers. Every request goes to exactly
 * one provider/model chosen by the user: no model fallback, no provider fallback,
 * no cross-provider uploads, and reference images are never dropped.
 */

type Provider = "kie" | "toapis" | "google";

export interface AppImageRequest {
  /** Model id from src/models.config.ts, e.g. "kie-gpt-image-2". */
  appModelId: string;
  prompt: string;
  /** Data URLs or http(s) URLs, in the order the prompt describes them. */
  referenceImages: string[];
  /** App ratio preset, e.g. "16:9", "4:5", "300x250". */
  ratio: string;
  quality: "1K" | "2K";
  signal?: AbortSignal;
}

/** What the UI shows (and users copy into bug reports) for a failed request. */
export interface AppErrorDetails {
  provider?: string;
  model?: string;
  code?: string;
  taskId?: string;
  status?: number;
  providerCode?: string;
}

export class AppImageError extends Error {
  readonly details: AppErrorDetails;
  constructor(message: string, details: AppErrorDetails = {}, cause?: unknown) {
    super(message, { cause });
    this.name = "AppImageError";
    this.details = details;
  }
  get code(): string | undefined {
    return this.details.code;
  }
}

/** Error details for the API response. Unknown errors still report their message; nothing is hidden. */
export function errorDetails(error: unknown): AppErrorDetails {
  if (error instanceof AppImageError) return error.details;
  if (isPiAiExtraError(error)) return { provider: error.provider, model: error.model, code: error.code, taskId: error.taskId, status: error.status };
  return { code: "unexpected" };
}

const SECRET_NAMES: Record<Provider, string> = { kie: "KIE_API_KEY", toapis: "TOAPIS_API_KEY", google: "GEMINI_API_KEY" };
const CATALOGUES: Record<Provider, readonly ImageModelInfo[]> = { kie: KIE_IMAGE_MODELS, toapis: TOAPIS_IMAGE_MODELS, google: GOOGLE_IMAGE_MODELS };
const TOAPIS_MODELS = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2", "doubao-seedream-5-0-pro", "gemini-3.1-flash-image-preview"]);

/** App model id → provider model operation. Text-to-image vs edit is chosen explicitly from the reference count. */
function resolveTarget(appModelId: string, referenceCount: number): { provider: Provider; model: string } {
  const hasReferences = referenceCount > 0;
  if (appModelId === "kie-gpt-image-2") return { provider: "kie", model: hasReferences ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image" };
  if (appModelId === "kie-grok-imagine-2") {
    return { provider: "kie", model: hasReferences ? "grok-imagine-image-2-0/image-edit" : "grok-imagine-image-2-0/text-to-image" };
  }
  if (appModelId === "kie-nano-banana-2") return { provider: "kie", model: "nano-banana-2" };
  if (TOAPIS_MODELS.has(appModelId)) return { provider: "toapis", model: appModelId };
  if (appModelId === "nano-banana-2") return { provider: "google", model: "gemini-3.1-flash-image" };
  if (appModelId === "nano-banana-pro") return { provider: "google", model: "gemini-3-pro-image" };
  throw new AppImageError(`模型 ${appModelId} 目前不支援（請在模型選單選擇其他模型）。`, { code: "unsupported_model", model: appModelId });
}

const PRESET_RATIOS: Record<string, number> = {
  "300x250": 300 / 250,
  "336x280": 336 / 280,
  "6:5": 6 / 5,
  "300x300": 1,
  "300x600": 300 / 600,
  "320x480": 320 / 480,
  "1.91:1": 1.91,
};

/** KIE GPT Image 2 documents ratios that are unavailable at 2K/4K. */
const KIE_GPT_UNSUPPORTED_AT: Record<string, readonly string[]> = {
  "2K": ["5:4", "4:5", "3:1", "1:3", "9:21"],
  "4K": ["1:1", "3:1", "1:3", "9:21"],
};

function ratioValue(ratio: string): number | undefined {
  if (PRESET_RATIOS[ratio] !== undefined) return PRESET_RATIOS[ratio];
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  return match ? Number(match[1]) / Number(match[2]) : undefined;
}

/** Picks the model's own value for the app preset: exact match, else the nearest supported ratio. */
function pickAspectRatio(info: ImageModelInfo, ratio: string, resolution: string | undefined): string | undefined {
  if (!info.aspectRatio) return undefined;
  const blocked = info.id.startsWith("gpt-image-2-") && resolution ? (KIE_GPT_UNSUPPORTED_AT[resolution] ?? []) : [];
  const candidates = info.aspectRatio.values.filter((value) => value !== "auto" && !blocked.includes(value));
  if (candidates.includes(ratio)) return ratio;
  const target = ratioValue(ratio) ?? 16 / 9;
  const distance = (value: string): number => Math.abs(Math.log((ratioValue(value) ?? 1) / target));
  return [...candidates].sort((a, b) => distance(a) - distance(b))[0];
}

function apiKeyFor(provider: Provider): string {
  const name = SECRET_NAMES[provider];
  const value = process.env[name]?.trim();
  if (!value) throw new AppImageError(`${name} 未設定或為空，請在 Settings 秘密設定 (Secrets) 中配置 ${name}。`, { code: "missing_key", provider });
  return value;
}

/** Turns a package error into a user-facing message that keeps provider/model and the error code. */
function toAppError(error: unknown): Error {
  if (!isPiAiExtraError(error)) return error instanceof Error ? error : new Error(String(error));
  const where = `${error.provider}/${error.model}`;
  const prefix =
    error.code === "content_blocked"
      ? `內容未通過 ${where} 安全審查（Safety Filter）`
      : error.code === "reference_limit"
        ? `參考圖片數量超出 ${where} 的上限（圖片不會被自動刪減，請減少素材或 Logo）`
        : error.code === "auth"
          ? `${where} 金鑰無效或未授權，請檢查 Secrets`
          : error.code === "insufficient_credits"
            ? `${where} 帳戶額度不足`
            : `${where} 生成失敗 [${error.code}]`;
  const detail = error.message.replace(/^\[[^\]]+\]\s*/, "");
  const details: AppErrorDetails = {
    provider: error.provider,
    model: error.model,
    code: error.code,
    ...(error.taskId ? { taskId: error.taskId } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.providerCode ? { providerCode: error.providerCode } : {}),
  };
  return new AppImageError(`${prefix}：${detail}`, details, error);
}

function logUsage(result: ImageGenerationResult, clientBusinessId: string | undefined): void {
  console.log(
    `[usage] ${result.provider}/${result.model} task=${result.taskId ?? "-"} ref=${clientBusinessId ?? "-"} elapsedMs=${result.elapsedMs} usage=${JSON.stringify(result.usage ?? null)}`,
  );
}

/** Generates or edits one image and returns it as a data URL. */
export async function generateAppImage(request: AppImageRequest): Promise<string> {
  const target = resolveTarget(request.appModelId, request.referenceImages.length);
  const info = CATALOGUES[target.provider].find((model) => model.id === target.model);
  if (!info) throw new AppImageError(`找不到模型設定 ${target.provider}/${target.model}`, { code: "unsupported_model", ...target });
  const resolution = info.resolution?.values.includes(request.quality) ? request.quality : undefined;
  const common = {
    apiKey: apiKeyFor(target.provider),
    prompt: request.prompt,
    referenceImages: request.referenceImages,
    aspectRatio: pickAspectRatio(info, request.ratio, resolution),
    signal: request.signal,
  };
  const clientBusinessId = target.provider === "toapis" ? `open-graph-single:${randomUUID()}` : undefined;
  try {
    const result =
      target.provider === "kie"
        ? await generateKieImage({ ...common, model: target.model, resolution, outputFormat: target.model === "nano-banana-2" ? "jpg" : undefined } as KieImageRequest)
        : target.provider === "toapis"
          ? await generateToapisImage({
              ...common,
              model: target.model,
              resolution,
              clientBusinessId,
              watermark: target.model === "doubao-seedream-5-0-pro" ? false : undefined,
            } as ToapisImageRequest)
          : await generateGoogleImage({
              ...common,
              model: target.model,
              resolution,
              headers: { "User-Agent": "aistudio-build" },
              safetySettings: [
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
              ],
            } as GoogleImageRequest);
    logUsage(result, clientBusinessId);
    const image = result.images[0];
    if (!image) {
      throw new AppImageError(`${result.provider}/${result.model} 沒有返回圖片`, {
        code: "no_output",
        provider: result.provider,
        model: result.model,
        ...(result.taskId ? { taskId: result.taskId } : {}),
      });
    }
    return image.dataUrl;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Gemini-style interleaved parts (text labels + inline images) → one prompt with numbered image markers. */
export function partsToPrompt(parts: ReadonlyArray<{ text?: string; inlineData?: { data: string; mimeType: string } }>): {
  prompt: string;
  referenceImages: string[];
} {
  const referenceImages: string[] = [];
  const lines: string[] = [];
  for (const part of parts) {
    if (part.inlineData) {
      referenceImages.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
      lines.push(`[Reference image ${referenceImages.length}]`);
    } else if (part.text) {
      lines.push(part.text);
    }
  }
  return { prompt: lines.join("\n\n"), referenceImages };
}
```

## Step 3: rewrite `server/providers/kie.ts`

- Keep `export interface KieGenerateOptions` and add `signal?: AbortSignal;`. Keep `export async function generateKieImage(options: KieGenerateOptions): Promise<string>`.
- Keep the destructuring of `options` (add `signal`) and keep the whole `// Construct prompt` block verbatim, including every rule text, so `promptText` is built exactly as before.
- Delete:
  - `mapKieAspectRatio` and `uploadBase64ToKie`;
  - the `KIE_API_KEY` check;
  - the candidate model list;
  - the uploads, `inputPayload`, `createTask` and polling code;
  - the imports from `./toapis` and `../../src/models.config`.
- Build the references in the order the prompt describes: edit mode → `[baseImage]`, otherwise `[templateImage, ...sourceImages, brandLogo]`, leaving out empty values.
- End the function with `return generateAppImage({ appModelId: modelId, prompt: promptText, referenceImages, ratio, quality: imageQuality, signal });`, importing `generateAppImage` from `./imageClient`.

## Step 4: rewrite `server/providers/toapis.ts`

- Keep `export async function generateToAPIsImage({...})` with its parameters, and keep the `buildPrompt` function and all prompt text verbatim.
- Delete:
  - `getToAPIsAspectRatio`, `fetchImageAsBase64`, `uploadImageToToAPIs`, `findImageUrlRecursively` and `extractToAPIsImageUrl`;
  - the `TOAPIS_API_KEY` check;
  - the parallel upload block;
  - `executeGenerationCall`, including every host loop and every fallback;
  - the final safety-retry `try/catch`.
- References: `[baseImage, templateImage, ...sourceImages, brandLogo]`, leaving out empty values.
- End with `return generateAppImage({ appModelId: modelId, prompt: buildPrompt(false), referenceImages, ratio, quality: imageQuality || "1K", signal });`.

## Step 5: update `server.ts`

- Remove `import { GoogleGenAI } from "@google/genai";` and the `getGeminiAspectRatio` helper. Keep `getInlineData`.
- Add `import { errorDetails, generateAppImage, partsToPrompt } from "./server/providers/imageClient";`.
- Pass `signal: clientAbortController.signal` in both `generateKieImage({...})` calls (generate and edit routes); both are missing it today.
- In both `/api/gemini/generate` and `/api/gemini/edit`, keep the code that builds the labelled `parts` array unchanged. Delete the `GEMINI_API_KEY` check, the `new GoogleGenAI(...)` client, `ai.models.generateContent(...)` and all response parsing after it. Replace them with:
  ```ts
  const { prompt: geminiPrompt, referenceImages: geminiImages } = partsToPrompt(parts);
  const imageUrl = await generateAppImage({
    appModelId: safeModelId,
    prompt: geminiPrompt,
    referenceImages: geminiImages,
    ratio,
    quality: imageQuality === "2K" ? "2K" : "1K",
    signal: clientAbortController.signal,
  });
  return sender.sendSuccess(imageUrl);
  ```
- In `createResponseSender`, change both `sendError` implementations to `sendError(status: number, error: string, cause?: unknown)`, and include `details: cause === undefined ? undefined : errorDetails(cause)`:
  - JSON mode: `res.status(status).json({ error, details })`;
  - NDJSON mode: `{ type: "error", error, details }`.
- On every 500 error path, pass the caught error as the third argument: `sender.sendError(500, err.message || "…", err)`, and in the route-level `catch (error)`: `sender.sendError(500, errorMsg, error)`.

## Step 6: remove Wokey

In `src/models.config.ts`, set `enabled: false` on `wokey-gpt-image-2.5` and `wokey-grok-imagine-2`. Delete `server/providers/wokey.ts`: it is never imported, and it depends on helpers removed in Step 4.

## Step 7: show errors in the UI (client)

**`src/lib/gemini.ts`**
- Add and export:
  ```ts
  export interface ImageErrorDetails { provider?: string; model?: string; code?: string; taskId?: string; status?: number; providerCode?: string }
  export class ImageRequestError extends Error {
    constructor(message: string, readonly details: ImageErrorDetails = {}) { super(message); this.name = "ImageRequestError"; }
  }
  ```
- Fix the NDJSON parser. Today, any server error whose message contains "JSON" is swallowed, because `catch (err) { if (!err.message.includes("JSON")) throw err; }` wraps event handling. Wrap only `JSON.parse` in `try/catch` (skip lines that do not parse), then handle the event outside it.
- For `{ type: "error" }` events, and for non-OK JSON responses, throw `new ImageRequestError(data.error || "生成失敗", data.details ?? {})`.
- In `generateOgImage` and `editOgImage`, make a single attempt: remove the retry loop and the 2-second waits. Keep `USER_CANCELLED` handling as it is.
- Add `export function formatErrorReport(error: unknown, context: { operation: "generate" | "edit"; appModelId: string; ratio?: string }): string`. It returns plain text such as:
  ```
  [OG 圖片錯誤報告]
  時間：2026-09-28T06:30:00.000Z
  操作：generate（比例 16:9）
  App 模型：kie-gpt-image-2
  Provider / Model：kie / gpt-image-2-image-to-image
  錯誤代碼：auth
  HTTP 狀態：401
  Task ID：task_xxx
  訊息：<full message>
  ```
  Omit lines whose value is unknown.

**`src/App.tsx`**
- Store the error as `{ message, details, report }` (use `formatErrorReport`) instead of a plain string. When several ratios are generated, say which ratio failed.
- The red error banner shows:
  - the message;
  - a compact line `provider / model · code · HTTP status · task id`;
  - a "複製錯誤資訊" button that copies `report` with `navigator.clipboard.writeText`. If that is unavailable, fall back to selecting the text.
- The banner stays until the user clicks "關閉". Keep cancellations silent.

**`src/components/DeepEditor.tsx`**
- Show edit failures in the same persistent form: message, details line and copy button, until dismissed. Do not use the 4-second toast for errors. Success toasts can stay as they are.

## Step 8: verify before finishing

1. `npm run lint` (tsc) and `npm run build` both pass, `npm start` (`node dist/server.mjs`) starts the server, and the `build` / `start` scripts are unchanged.
2. With a wrong `KIE_API_KEY`, generating with "Grok Imagine 2.0" shows a persistent banner containing `kie / grok-imagine-image-2-0/...` and code `auth`, and the copy button copies the full report.
3. "Grok Imagine 2.0" with a template, 5 source images and a logo (7 images) shows a `reference_limit` error. Do not silently drop images.
4. Cancelling a running generation shows no error banner.
5. A normal generation with valid keys still returns an image, and the server log prints one `[usage] …` line per request.
6. Search the server code: no references remain to `api.toapis.cn`, `redpandaai` (outside the packages), `slice(0, 10)`, `slice(0, 5)`, `nanobanana2`, `SAFETY_REVIEW_BLOCKED`, or `@google/genai`.

Finish with a short list of every file you changed, created or deleted.
