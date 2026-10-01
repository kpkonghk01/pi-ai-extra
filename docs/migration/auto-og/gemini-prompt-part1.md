# Auto OG migration, Part 1 of 3: server

You are editing this Google AI Studio app: a React + Vite client and an Express `server.ts`.

Image generation (collage and edit) currently calls Gemini directly through `@google/genai`. Move it to three published server-only packages so that users can pick an image model grouped by provider (Google, KIE, ToAPIs).

## Rules for all three parts

1. **No fallback of any kind.** Each request uses exactly one provider and one model: the one the user selected.
   - Delete the Gemini model lists in `/api/generate-collage` and `/api/edit-image`, which try `gemini-3-pro-image`, `gemini-3.1-flash-image` and `gemini-3.1-flash-lite-image` in turn.
   - Do not add any retry, alternative model or alternative provider.
   - Never re-send a request that may already have been billed.
2. **Never drop reference images.** Reference images are never sliced, filtered or dropped to fit a model. A model that cannot take them is disabled in the UI and rejected by the server.
3. **API keys stay on the server.**
   - Read `GEMINI_API_KEY` (or `API_KEY`), `KIE_API_KEY` and `TOAPIS_API_KEY` from `process.env` in server code only, and pass them explicitly to the packages.
   - Remove the Vite `define` that copies the Gemini key into the browser bundle.
   - Browser code must not read `process.env`.
4. **Every failure reaches the UI completely.** Show the provider, the model, the error code, the HTTP status, the task id when known, and the message.
   - The error panel (Part 2) stays until the user closes it.
   - It has a 「複製錯誤資訊」 button.
   - Do not replace errors with generic text.
5. **Keep everything else as it is.**
   - Keep every prompt text exactly as it is, except the edits shown here.
   - Do not touch `/api/generate-viral-titles`, `/api/fetch-article`, `/api/extract-page-images` or their `@google/genai` usage. Title generation keeps calling Gemini directly.
   - Firebase, history, PWA, layout and styling stay unchanged.
6. **Do not change the `build` or `start` scripts.** The server is built as ESM to `dist/server.mjs`.
7. **Copy new files exactly as given, and do not invent package APIs.** Where a diff below does not match the current code exactly, apply its intent to the matching code. Do not skip it.

## Step 1: dependencies

Add these three entries to `dependencies` in `package.json`, and change nothing else in that file:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.2.0/hk01-pi-ai-extra-google-0.2.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
```

## Step 2: create the shared modules

These modules are imported by both the server and the browser, and contain no provider code. Create each file with exactly this content.

`shared/imageOutput.ts`:

```ts
import type { AspectRatio } from '../types';

/**
 * Final output size for each ratio preset, and the generation resolution that covers it.
 * Shared by the server (what to request) and the browser (post-processing and estimates).
 */
export type OutputResolution = '1K' | '2K';

export interface OutputSpec {
  width: number;
  height: number;
  resolution: OutputResolution;
}

export const OUTPUT_SPECS: Record<AspectRatio, OutputSpec> = {
  '16:9': { width: 1200, height: 675, resolution: '1K' },
  '4:5': { width: 1600, height: 2000, resolution: '2K' },
  '9:16': { width: 1080, height: 1920, resolution: '2K' },
  '1:1': { width: 1080, height: 1080, resolution: '1K' },
  '300x250': { width: 300, height: 250, resolution: '1K' },
  '320x250': { width: 320, height: 250, resolution: '1K' },
  '300x300': { width: 300, height: 300, resolution: '1K' },
};

const FALLBACK_SPEC: OutputSpec = { width: 1024, height: 1024, resolution: '1K' };

export function outputSpec(ratio: string): OutputSpec {
  return OUTPUT_SPECS[ratio as AspectRatio] ?? FALLBACK_SPEC;
}

/** Width / height of a preset ("300x250") or a ratio ("16:9"); undefined when unparseable. */
export function ratioValue(ratio: string): number | undefined {
  const preset = OUTPUT_SPECS[ratio as AspectRatio];
  if (preset) return preset.width / preset.height;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  return match ? Number(match[1]) / Number(match[2]) : undefined;
}
```


`shared/imageModels.ts`:

```ts
import { outputSpec, type OutputResolution } from './imageOutput';

/**
 * Image model types and pure helpers shared by the server (server/imageModels.ts builds
 * the list) and the browser (selector, temperature control, estimates). No provider
 * package is imported here, so this file is safe in the browser bundle.
 */

export type ImageProvider = 'google' | 'kie' | 'toapis';

/** Selects prompt wording tuned for a model family (see server.ts collage route). */
export type PromptProfile = 'nano-banana-2' | 'default';

/** How well a model follows a colour-stroke mask that is sent as a reference image. */
export type MaskEditing = 'supported' | 'reference-only';

/** App-maintained price estimate; never a provider-reported usage record. */
export interface PriceEstimate {
  /** USD per generated image, by requested resolution. */
  perImageUsd: Record<OutputResolution, number>;
  /** USD per 1M input tokens; 0 when the per-image price already includes input. */
  inputPerMillionTokensUsd: number;
}

/** Error fields returned for failed image requests (server/imageClient.ts) and shown by the ErrorPanel. */
export interface ImageErrorDetails {
  appModelId?: string;
  provider?: string;
  model?: string;
  code?: string;
  status?: number;
  taskId?: string;
  providerCode?: string;
}

/** One entry of GET /api/image-models. */
export interface ImageModelView {
  id: string;
  label: string;
  description: string;
  provider: ImageProvider;
  providerLabel: string;
  /** Provider model operation used with reference images (KIE GPT Image 2 uses text-to-image without). */
  providerModel: string;
  /** Reference image types the model accepts (the app sends JPEG or PNG). */
  acceptedMimeTypes: string[];
  /** Reference images the model accepts; max null = no documented limit. */
  referenceLimit: { min: number; max: number | null };
  /** Accepted temperature range, or null when the model does not accept temperature. */
  temperature: { min: number; max: number } | null;
  promptProfile: PromptProfile;
  maskEditing: MaskEditing;
  /** Null when no verified price is known; the UI shows "—". */
  price: PriceEstimate | null;
  /** False when the server has no key for this provider. */
  available: boolean;
  unavailableReason: string | null;
}

export const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';
export const PROVIDER_ORDER: readonly ImageProvider[] = ['google', 'kie', 'toapis'];
export const USD_TO_HKD = 7.8;

export const TEMPERATURE_SUPPORT_NOTE =
  'Temperature 只適用於 Google Gemini 直連的 Nano Banana 2 / Pro；KIE、ToAPIs 的模型（包括它們提供的 Nano Banana）不支援此設定。';

export const MASK_REFERENCE_ONLY_NOTE =
  '此模型以參考圖方式理解遮罩，局部編輯可能影響遮罩以外的範圍；需要精準局部修改時建議使用 Nano Banana 系列。';

/** `value` when the model accepts temperature, otherwise undefined (the server rejects it for the others). */
export function temperatureFor(model: ImageModelView | undefined, value: number): number | undefined {
  return model?.temperature ? value : undefined;
}

/** Why `model` cannot take `referenceCount` reference images, or null when it can. */
export function referenceIssue(model: ImageModelView, referenceCount: number): string | null {
  const { min, max } = model.referenceLimit;
  if (max !== null && referenceCount > max) return `最多 ${max} 張參考圖，已選 ${referenceCount} 張`;
  if (referenceCount < min) return `至少需要 ${min} 張參考圖，已選 ${referenceCount} 張`;
  return null;
}

/** Why `model` cannot be used right now (missing key or too many images), or null. */
export function modelIssue(model: ImageModelView, referenceCount: number): string | null {
  if (!model.available) return model.unavailableReason ?? '此模型目前不可用';
  return referenceIssue(model, referenceCount);
}

/** Reference images that still fit after `used` are taken (Infinity when there is no limit). */
export function remainingReferenceCapacity(model: ImageModelView, used: number): number {
  return model.referenceLimit.max === null ? Number.POSITIVE_INFINITY : Math.max(0, model.referenceLimit.max - used);
}

/** Rough input token count used by the estimates (same constants as before the migration). */
export function estimateInputTokens(inputImages: number, promptChars: number): number {
  return Math.ceil(inputImages * 258 + promptChars * 0.25);
}

/**
 * Estimated USD for one request per entry of `ratios`, or null when the model's price is unknown.
 * Each output image is its own request, so input tokens are counted once per image.
 */
export function estimateCostUsd(
  model: ImageModelView | undefined,
  input: { inputImages: number; promptChars: number; ratios: readonly string[] },
): number | null {
  const price = model?.price;
  if (!price) return null;
  const inputCost = (estimateInputTokens(input.inputImages, input.promptChars) / 1_000_000) * price.inputPerMillionTokensUsd;
  return input.ratios.reduce((sum, ratio) => sum + inputCost + price.perImageUsd[outputSpec(ratio).resolution], 0);
}
```


## Step 3: create the server modules

`server/imageModels.ts` is the list of the nine image models the app offers.
- Reference limits and temperature support come from the package catalogues, not from this file.
- `price` is an estimate shown in the UI. `null` means unknown, and the UI shows "—".

`server/imageClient.ts` is the only code that calls the image packages:
- It validates the request first. Each of these returns HTTP 400 or 503 before any provider call: an unknown model, a missing key, a temperature that is not a number or that the model does not accept, a missing or unreadable ratio, or too many reference images.
- It then calls exactly one provider.
- Rules go in Gemini `systemInstruction` where the model supports it. Otherwise they go at the start of the prompt.
- It picks each model's own aspect ratio: the exact value when supported, otherwise the nearest one.
- It logs provider-reported usage with the task id.

`server/ndjson.ts` streams the response:
- It sends a ping line every 10 seconds, so the 60-second proxy idle timeout cannot cut long KIE/ToAPIs tasks.
- It stops provider polling when the browser disconnects or the user cancels.
- Each package still applies its own task limit (KIE 10 minutes, ToAPIs 6, Google 5). Node sets no response timeout, so no server timeout change is needed.

`server/imageModels.ts`:

```ts
import { KIE_IMAGE_MODELS } from '@hk01/pi-ai-extra-kie';
import { TOAPIS_IMAGE_MODELS } from '@hk01/pi-ai-extra-toapis';
// The Google 0.2.0 type includes the optional temperature / systemInstruction catalogue fields.
import { GOOGLE_IMAGE_MODELS, type ImageModelInfo } from '@hk01/pi-ai-extra-google';
import type { ImageModelView, ImageProvider, MaskEditing, PriceEstimate, PromptProfile } from '../shared/imageModels';

/**
 * The image models this app offers, and how each maps to a provider model operation.
 * Limits and capabilities come from the package catalogues, never from this file.
 */
interface RegistryEntry {
  id: string;
  label: string;
  description: string;
  provider: ImageProvider;
  /** Provider operation used with reference images (and without, unless textOnlyModel is set). */
  model: string;
  /** Provider text-to-image operation used when a request has no reference images. */
  textOnlyModel?: string;
  promptProfile: PromptProfile;
  /** "supported": Gemini-family models, which this app has always used for mask edits. */
  maskEditing: MaskEditing;
  /** Verified list prices only (Google pricing page 2026-10-01, ToAPIs GPT Image 2.5 doc 2026-09-09). */
  price: PriceEstimate | null;
}

const REGISTRY: readonly RegistryEntry[] = [
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2（2代平衡）',
    description: 'Google 直連 Gemini 3.1 Flash Image，速度快，適合一般拼貼。',
    provider: 'google',
    model: 'gemini-3.1-flash-image',
    promptProfile: 'nano-banana-2',
    maskEditing: 'supported',
    price: { perImageUsd: { '1K': 0.067, '2K': 0.101 }, inputPerMillionTokensUsd: 0.5 },
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro（Pro 思考）',
    description: 'Google 直連 Gemini 3 Pro Image，細節更豐富，適合高要求圖片。',
    provider: 'google',
    model: 'gemini-3-pro-image',
    promptProfile: 'default',
    maskEditing: 'supported',
    price: { perImageUsd: { '1K': 0.134, '2K': 0.134 }, inputPerMillionTokensUsd: 2 },
  },
  {
    id: 'kie-nano-banana-2',
    label: 'Nano Banana 2 (KIE)',
    description: 'KIE 提供的 Gemini 3.1 Flash Image。',
    provider: 'kie',
    model: 'nano-banana-2',
    promptProfile: 'nano-banana-2',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'kie-gpt-image-2',
    label: 'GPT Image 2 (KIE)',
    description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。',
    provider: 'kie',
    model: 'gpt-image-2-image-to-image',
    textOnlyModel: 'gpt-image-2-text-to-image',
    promptProfile: 'default',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 Preview (ToAPIs)',
    description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
    provider: 'toapis',
    model: 'gemini-3.1-flash-image-preview',
    promptProfile: 'nano-banana-2',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2。',
    provider: 'toapis',
    model: 'gpt-image-2',
    promptProfile: 'default',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Flare。',
    provider: 'toapis',
    model: 'gpt-image-2.5-flare',
    promptProfile: 'default',
    maskEditing: 'reference-only',
    price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。',
    provider: 'toapis',
    model: 'gpt-image-2.5-sunburst',
    promptProfile: 'default',
    maskEditing: 'reference-only',
    price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
  },
  {
    id: 'doubao-seedream-5-0-pro',
    label: 'Seedream 5.0 Pro (ToAPIs)',
    description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。',
    provider: 'toapis',
    model: 'doubao-seedream-5-0-pro',
    promptProfile: 'default',
    maskEditing: 'reference-only',
    price: null,
  },
];

const PROVIDER_LABELS: Record<ImageProvider, string> = { google: 'Google Gemini', kie: 'KIE 提供', toapis: 'ToAPIs 提供' };
const CATALOGUES: Record<ImageProvider, readonly ImageModelInfo[]> = {
  google: GOOGLE_IMAGE_MODELS,
  kie: KIE_IMAGE_MODELS,
  toapis: TOAPIS_IMAGE_MODELS,
};
/** Google also accepts API_KEY, like the title and article routes. */
const SECRET_NAMES: Record<ImageProvider, readonly string[]> = {
  google: ['GEMINI_API_KEY', 'API_KEY'],
  kie: ['KIE_API_KEY'],
  toapis: ['TOAPIS_API_KEY'],
};

export interface ResolvedOperation {
  entry: RegistryEntry;
  info: ImageModelInfo;
}

export function findRegistryEntry(appModelId: string): RegistryEntry | undefined {
  return REGISTRY.find((entry) => entry.id === appModelId);
}

function catalogueInfo(provider: ImageProvider, model: string): ImageModelInfo | undefined {
  return CATALOGUES[provider].find((info) => info.id === model);
}

/** The provider operation for this request: text-to-image without references when the model has one. */
export function resolveOperation(entry: RegistryEntry, referenceCount: number): ImageModelInfo | undefined {
  const model = referenceCount === 0 && entry.textOnlyModel ? entry.textOnlyModel : entry.model;
  return catalogueInfo(entry.provider, model);
}

/** The server-side key for a provider, or undefined when none is configured. */
export function providerKey(provider: ImageProvider, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of SECRET_NAMES[provider]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function secretName(provider: ImageProvider): string {
  return SECRET_NAMES[provider][0] ?? provider;
}

function operationInfos(entry: RegistryEntry): ImageModelInfo[] {
  const models = entry.textOnlyModel ? [entry.textOnlyModel, entry.model] : [entry.model];
  return models.flatMap((model) => {
    const info = catalogueInfo(entry.provider, model);
    return info ? [info] : [];
  });
}

function toView(entry: RegistryEntry, env: NodeJS.ProcessEnv): ImageModelView {
  const infos = operationInfos(entry);
  const main = catalogueInfo(entry.provider, entry.model);
  const maxes = infos.map((info) => info.referenceImages.max);
  const missingFromPackage = infos.length === 0 || !main;
  const hasKey = providerKey(entry.provider, env) !== undefined;
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    provider: entry.provider,
    providerLabel: PROVIDER_LABELS[entry.provider],
    providerModel: entry.model,
    acceptedMimeTypes: main ? [...main.referenceImages.acceptedMimeTypes] : [],
    referenceLimit: {
      min: infos.length > 0 ? Math.min(...infos.map((info) => info.referenceImages.min)) : 0,
      max: maxes.includes(null) ? null : Math.max(0, ...maxes.map((max) => max ?? 0)),
    },
    temperature: main?.temperature ? { min: main.temperature.min, max: main.temperature.max } : null,
    promptProfile: entry.promptProfile,
    maskEditing: entry.maskEditing,
    price: entry.price,
    available: hasKey && !missingFromPackage,
    unavailableReason: missingFromPackage
      ? `已安裝的 ${entry.provider} 套件不包含 ${entry.model}`
      : hasKey
        ? null
        : `伺服器未設定 ${secretName(entry.provider)}`,
  };
}

/** Body of GET /api/image-models: every offered model, in selector order. */
export function listImageModels(env: NodeJS.ProcessEnv = process.env): ImageModelView[] {
  return REGISTRY.map((entry) => toView(entry, env));
}

export function imageModelView(appModelId: string, env: NodeJS.ProcessEnv = process.env): ImageModelView | undefined {
  const entry = findRegistryEntry(appModelId);
  return entry ? toView(entry, env) : undefined;
}
```


`server/imageClient.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { generateKieImage, isPiAiExtraError, type ImageGenerationResult, type KieImageRequest, type PiAiExtraError } from '@hk01/pi-ai-extra-kie';
import { generateToapisImage, type ToapisImageRequest } from '@hk01/pi-ai-extra-toapis';
// The Google 0.2.0 type includes the optional temperature / systemInstruction catalogue fields.
import { generateGoogleImage, type GoogleImageRequest, type ImageModelInfo } from '@hk01/pi-ai-extra-google';
import { TEMPERATURE_SUPPORT_NOTE, type ImageErrorDetails, type ImageProvider } from '../shared/imageModels';
import { outputSpec, ratioValue } from '../shared/imageOutput';
import { findRegistryEntry, providerKey, resolveOperation, secretName } from './imageModels';

/**
 * The only place this app talks to image providers. Each request goes to exactly the
 * provider/model the user selected: no model or provider fallback, no cross-provider
 * uploads, reference images are never dropped, and a billed submission is never re-sent.
 */

export interface ImagePart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}

export interface AppImageRequest {
  appModelId: string;
  /** Gemini-style parts in order: text labels and inline images. */
  parts: readonly ImagePart[];
  /** Model rules. Sent as systemInstruction where supported, otherwise placed before the prompt. */
  systemInstruction: string;
  /**
   * App ratio preset ("16:9", "300x250", …) or the input image's "width:height". Decides the
   * resolution, and the aspect ratio unless the input aspect is kept. Required when an aspect
   * ratio has to be chosen.
   */
  ratio: string | undefined;
  /** Edits: keep the input image's aspect where the model can (Google: omit; KIE: "auto"). */
  keepInputAspect?: boolean;
  /** Raw request value; validated here (number, and accepted by the model). */
  temperature?: unknown;
}

/** What the UI shows, and users copy into bug reports, for a failed request. */
export type AppErrorDetails = ImageErrorDetails;

export class AppImageError extends Error {
  readonly details: AppErrorDetails;
  /** HTTP status when the error is found before any provider call. */
  readonly httpStatus: number;
  constructor(message: string, details: AppErrorDetails = {}, options: { httpStatus?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppImageError';
    this.details = details;
    this.httpStatus = options.httpStatus ?? 500;
  }
}

function packageErrorDetails(error: PiAiExtraError, appModelId?: string): AppErrorDetails {
  return {
    ...(appModelId ? { appModelId } : {}),
    provider: error.provider,
    model: error.model,
    code: error.code,
    ...(error.taskId ? { taskId: error.taskId } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.providerCode ? { providerCode: error.providerCode } : {}),
  };
}

/** Details for an API error response. Unknown errors still report their message; nothing is hidden. */
export function errorDetails(error: unknown): AppErrorDetails {
  if (error instanceof AppImageError) return error.details;
  if (isPiAiExtraError(error)) return packageErrorDetails(error);
  return { code: 'unexpected' };
}

export interface PreparedImageRequest {
  appModelId: string;
  provider: ImageProvider;
  info: ImageModelInfo;
  apiKey: string;
  prompt: string;
  systemInstruction: string | undefined;
  referenceImages: string[];
  aspectRatio: string | undefined;
  resolution: string | undefined;
  temperature: number | undefined;
}

/**
 * KIE GPT Image 2 ratios that are unavailable at 2K. The catalogue states this only as a note
 * (the package rejects them), so it is repeated here to pick a ratio the package accepts.
 */
const KIE_GPT_UNSUPPORTED_AT: Record<string, readonly string[]> = {
  '2K': ['5:4', '4:5', '3:1', '1:3', '9:21'],
};

/** The model's own ratio for an app preset: an exact match, otherwise the nearest supported ratio. */
function pickAspectRatio(info: ImageModelInfo, ratio: string, target: number, resolution: string | undefined): string | undefined {
  if (!info.aspectRatio) return undefined;
  const blocked = info.id.startsWith('gpt-image-2-') && resolution ? (KIE_GPT_UNSUPPORTED_AT[resolution] ?? []) : [];
  const candidates = info.aspectRatio.values.filter((value) => value !== 'auto' && !blocked.includes(value));
  if (candidates.includes(ratio)) return ratio;
  const distance = (value: string): number => Math.abs(Math.log((ratioValue(value) ?? Number.POSITIVE_INFINITY) / target));
  return [...candidates].sort((a, b) => distance(a) - distance(b))[0];
}

/**
 * The aspect value that keeps the input image's aspect: "auto" where offered, omitted where the
 * model matches the input by default (Gemini), or null when the model cannot keep it.
 */
function inputAspectValue(info: ImageModelInfo): string | undefined | null {
  if (!info.aspectRatio) return undefined;
  if (info.aspectRatio.values.includes('auto')) return 'auto';
  return info.aspectRatio.default === null && !info.aspectRatio.required ? undefined : null;
}

/** Gemini-style interleaved parts → one prompt with numbered image markers, images kept in order. */
export function partsToPrompt(parts: readonly ImagePart[]): { prompt: string; referenceImages: string[] } {
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
  return { prompt: lines.join('\n\n'), referenceImages };
}

function aspectRatioFor(info: ImageModelInfo, request: AppImageRequest, resolution: string | undefined, base: AppErrorDetails): string | undefined {
  const kept = request.keepInputAspect ? inputAspectValue(info) : null;
  if (kept !== null) return kept;
  const target = request.ratio === undefined ? undefined : ratioValue(request.ratio);
  if (target === undefined || !Number.isFinite(target) || target <= 0) {
    throw new AppImageError(`無法判斷圖片比例（收到「${request.ratio ?? ''}」），無法為 ${info.id} 選擇比例。`, { ...base, code: 'invalid_request' }, { httpStatus: 400 });
  }
  return pickAspectRatio(info, request.ratio ?? '', target, resolution);
}

function validTemperature(value: unknown, base: AppErrorDetails): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppImageError('temperature 必須是數字。', { ...base, code: 'invalid_request' }, { httpStatus: 400 });
  }
  return value;
}

/** Validates everything that can fail before a provider is called (HTTP 400 / 503). */
export function prepareAppImage(request: AppImageRequest): PreparedImageRequest {
  const entry = findRegistryEntry(request.appModelId);
  if (!entry) {
    throw new AppImageError(`不支援的圖片模型「${request.appModelId}」，請在模型選單重新選擇。`, { code: 'unsupported_model', appModelId: request.appModelId }, { httpStatus: 400 });
  }
  const base = { appModelId: entry.id, provider: entry.provider };
  const { prompt, referenceImages } = partsToPrompt(request.parts);
  const info = resolveOperation(entry, referenceImages.length);
  if (!info) throw new AppImageError(`已安裝的 ${entry.provider} 套件不包含 ${entry.model}。`, { ...base, code: 'unsupported_model' });
  const target = { ...base, model: info.id };

  const apiKey = providerKey(entry.provider);
  if (!apiKey) {
    throw new AppImageError(`伺服器未設定 ${secretName(entry.provider)}，無法使用 ${entry.label}。`, { ...target, code: 'missing_key' }, { httpStatus: 503 });
  }
  const temperature = validTemperature(request.temperature, target);
  if (temperature !== undefined && !info.temperature) {
    throw new AppImageError(`${entry.label} 不支援 Temperature。${TEMPERATURE_SUPPORT_NOTE}`, { ...target, code: 'temperature_unsupported' }, { httpStatus: 400 });
  }
  const { min, max } = info.referenceImages;
  if (referenceImages.length < min || (max !== null && referenceImages.length > max)) {
    const limit = max === null ? `至少 ${min} 張` : `${min}–${max} 張`;
    throw new AppImageError(`${entry.label} 接受 ${limit}參考圖，這次有 ${referenceImages.length} 張（圖片不會被自動刪減）。`, { ...target, code: 'reference_limit' }, { httpStatus: 400 });
  }

  const wanted = outputSpec(request.ratio ?? '').resolution;
  const resolution = info.resolution?.values.includes(wanted) ? wanted : undefined;
  const separateRules = info.systemInstruction === true;
  return {
    ...target,
    info,
    apiKey,
    prompt: separateRules ? prompt : `${request.systemInstruction.trim()}\n\n${prompt}`,
    systemInstruction: separateRules ? request.systemInstruction : undefined,
    referenceImages,
    aspectRatio: aspectRatioFor(info, request, resolution, target),
    resolution,
    temperature,
  };
}

/** Turns a package error into a user-facing message that keeps provider/model and the error code. */
function toAppError(error: unknown, appModelId: string): Error {
  if (error instanceof AppImageError || !isPiAiExtraError(error)) return error instanceof Error ? error : new Error(String(error));
  const where = `${error.provider}/${error.model}`;
  const prefix =
    error.code === 'content_blocked'
      ? `內容未通過 ${where} 安全審查`
      : error.code === 'reference_limit'
        ? `參考圖片數量超出 ${where} 的上限（圖片不會被自動刪減）`
        : error.code === 'auth'
          ? `${where} 金鑰無效或未授權，請檢查 Secrets`
          : error.code === 'insufficient_credits'
            ? `${where} 帳戶額度不足`
            : `${where} 生成失敗 [${error.code}]`;
  const detail = error.message.replace(/^\[[^\]]+\]\s*/, '');
  return new AppImageError(`${prefix}：${detail}`, packageErrorDetails(error, appModelId), { cause: error });
}

/** Provider-reported usage, logged per task id for later per-app recording. */
function logUsage(result: ImageGenerationResult, appModelId: string, clientBusinessId: string | undefined): void {
  console.info(
    `[usage] app=auto-og model=${appModelId} ${result.provider}/${result.model} task=${result.taskId ?? '-'} ref=${clientBusinessId ?? '-'} elapsedMs=${result.elapsedMs} usage=${JSON.stringify(result.usage ?? null)}`,
  );
}

async function callProvider(prepared: PreparedImageRequest, signal: AbortSignal | undefined, clientBusinessId: string | undefined): Promise<ImageGenerationResult> {
  const common = {
    apiKey: prepared.apiKey,
    model: prepared.info.id,
    prompt: prepared.prompt,
    referenceImages: prepared.referenceImages,
    aspectRatio: prepared.aspectRatio,
    resolution: prepared.resolution,
    signal,
  };
  if (prepared.provider === 'google') {
    return generateGoogleImage({ ...common, temperature: prepared.temperature, systemInstruction: prepared.systemInstruction } as GoogleImageRequest);
  }
  if (prepared.provider === 'kie') return generateKieImage(common as KieImageRequest);
  return generateToapisImage({
    ...common,
    clientBusinessId,
    watermark: prepared.info.watermark ? false : undefined,
  } as ToapisImageRequest);
}

/** Generates or edits one image with the prepared provider/model and returns it as a data URL. */
export async function runAppImage(prepared: PreparedImageRequest, signal?: AbortSignal): Promise<string> {
  const clientBusinessId = prepared.provider === 'toapis' ? `auto-og:${randomUUID()}` : undefined;
  try {
    const result = await callProvider(prepared, signal, clientBusinessId);
    logUsage(result, prepared.appModelId, clientBusinessId);
    const image = result.images[0];
    if (!image) {
      throw new AppImageError(`${result.provider}/${result.model} 沒有返回圖片。`, {
        appModelId: prepared.appModelId,
        provider: result.provider,
        model: result.model,
        code: 'no_output',
        ...(result.taskId ? { taskId: result.taskId } : {}),
      });
    }
    return image.dataUrl;
  } catch (error) {
    throw toAppError(error, prepared.appModelId);
  }
}
```


`server/ndjson.ts`:

```ts
import type { Response } from 'express';

/** Keeps the connection busy so proxies with a 60-second idle timeout do not cut long image tasks. */
const PING_INTERVAL_MS = 10_000;

/**
 * Streams one image request as NDJSON: a `start` line, a `ping` line every 10 s, then a single
 * `complete` line (`rawImageBase64`) or `error` line (`error`, `details`).
 * When the client disconnects, `signal` aborts so provider polling stops; a task that was
 * already submitted is still billed by the provider.
 */
export async function streamImageResponse(
  res: Response,
  work: (signal: AbortSignal) => Promise<{ rawImageBase64: string }>,
  describeError: (error: unknown) => { error: string; details: object },
): Promise<void> {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (event: object): void => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const startedAt = Date.now();
  write({ type: 'start' });
  const timer = setInterval(() => write({ type: 'ping', elapsedSec: Math.round((Date.now() - startedAt) / 1000) }), PING_INTERVAL_MS);
  try {
    const result = await work(abort.signal);
    write({ type: 'complete', ...result });
  } catch (error) {
    console.error('[image] request failed:', error);
    write({ type: 'error', ...describeError(error) });
  } finally {
    clearInterval(timer);
    if (!res.writableEnded) res.end();
  }
}
```


## Step 4: update `server.ts`

Apply this diff. It:
- imports the new modules and removes the Gemini-only `mapRatioToSupported`, `mapQualityToSize` and `buildImageConfig` helpers.
- adds `GET /api/image-models` and a `sendImageError` helper.
- **`/api/generate-collage`:**
  - rejects an unknown ratio preset with HTTP 400;
  - no longer creates a `GoogleGenAI` client or loops over models;
  - the `isNanoBanana2` prompt branch now applies to every Nano Banana 2 entry (Google, KIE, ToAPIs) through the model's `promptProfile`;
  - the composed `parts` and `systemInstruction` go to `prepareAppImage`, and the result streams through `streamImageResponse`.
- **`/api/edit-image`:**
  - sends references in a fixed order: Image 1 base, Image 2 mask, then the extra reference, which now has its own label;
  - keeps the input image's aspect where the model allows it (Google: no ratio; KIE: `auto`); other models need the request's `sourceAspect` ("width:height") and get the nearest ratio, otherwise HTTP 400;
  - uses temperature 0.7 on models that accept temperature, unless the request sets one (logo replacement sends 0.5).

```diff
diff --git a/server.ts b/server.ts
index 10ac9b2..abe6d32 100644
--- a/server.ts
+++ b/server.ts
@@ -2,6 +2,10 @@ import express from "express";
 import path from "path";
 import { createServer as createViteServer } from "vite";
 import { GoogleGenAI } from "@google/genai";
+import { AppImageError, errorDetails, prepareAppImage, runAppImage, type ImagePart } from "./server/imageClient";
+import { imageModelView, listImageModels } from "./server/imageModels";
+import { streamImageResponse } from "./server/ndjson";
+import { OUTPUT_SPECS } from "./shared/imageOutput";
 
 const app = express();
 const PORT = 3000;
@@ -27,47 +31,32 @@ const urlToAsset = async (url: string) => {
   };
 };
 
-const mapRatioToSupported = (ratio: string): string => {
-  switch (ratio) {
-    case "2:3": return "3:4"; 
-    case "3:2": return "4:3";
-    case "4:5": return "3:4";
-    case "300x250": return "4:3";
-    case "320x250": return "4:3";
-    case "300x300": return "1:1";
-    default: return ratio;
-  }
-};
-
-const mapQualityToSize = (quality: string): string => {
-  return "2K"; 
-};
-
-const buildImageConfig = (modelName: string, ratio?: string, quality?: string, temperature?: number) => {
-  const config: any = {};
-  if (ratio) {
-    config.aspectRatio = mapRatioToSupported(ratio);
-  }
-  const isLite = modelName.toLowerCase().includes("lite");
-  if (!isLite) {
-    if (quality) {
-      config.imageSize = mapQualityToSize(quality);
-    } else {
-      config.imageSize = "1K";
-    }
-  }
-  if (typeof temperature === "number" && !isNaN(temperature)) {
-    config.temperature = temperature;
-  }
-  return config;
-};
-
 // API: Check config if api key is present on the server
 app.get("/api/config", (req, res) => {
   const hasKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
   res.json({ hasApiKey: hasKey });
 });
 
+// API: Image models for the selector, with limits from the pi-ai-extra catalogues and key availability
+app.get("/api/image-models", (req, res) => {
+  res.json({ models: listImageModels() });
+});
+
+/** Edits keep the previous fixed temperature, sent only to models that accept temperature. */
+const EDIT_TEMPERATURE = 0.7;
+
+/** Error body for both JSON responses and the NDJSON `error` line. */
+function imageErrorBody(error: unknown) {
+  return { error: error instanceof Error ? error.message : String(error), details: errorDetails(error) };
+}
+
+/** Errors found before streaming starts (unknown model, missing key, unsupported option) as JSON. */
+function sendImageError(res: express.Response, route: string, error: unknown) {
+  console.error(`[PROXY ERROR] ${route} failed:`, error);
+  if (res.headersSent) return;
+  res.status(error instanceof AppImageError ? error.httpStatus : 500).json(imageErrorBody(error));
+}
+
 // Helper to extract and format HTML text into clean, structured paragraphs
 function parseHtmlToStructuredParagraphs(html: string): string {
   // 1. Remove non-article script/style/nav/header/footer/iframe/comment blocks
@@ -405,11 +394,6 @@ ${articleText.slice(0, 10000)}
 // API: Process Collage Generation via Tokyo Cloud Run server proxy
 app.post("/api/generate-collage", async (req, res) => {
   try {
-    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
-    if (!apiKey) {
-      return res.status(401).json({ error: "Missing backend Gemini API Key" });
-    }
-
     const {
       templateAssets,
       sourceAssets,
@@ -440,12 +424,12 @@ app.post("/api/generate-collage", async (req, res) => {
       `;
     }
 
-    const tempVal = typeof temperature === 'number' && !isNaN(temperature) ? temperature : 0.7;
-
-    const ai = new GoogleGenAI({ apiKey });
-    const parts: any[] = [];
+    if (!Object.prototype.hasOwnProperty.call(OUTPUT_SPECS, String(ratio))) {
+      return res.status(400).json({ error: `不支援的輸出比例「${ratio ?? ""}」。`, details: { code: "invalid_request", appModelId: String(selectedModel ?? "") } });
+    }
+    const parts: ImagePart[] = [];
 
-    const isNanoBanana2 = selectedModel === "nano-banana-2" || selectedModel === "nano-banana-2-lite";
+    const isNanoBanana2 = imageModelView(String(selectedModel ?? ""))?.promptProfile === "nano-banana-2";
 
     let nanoBanana2SourceInstruction = "";
     if (isNanoBanana2 && sourceAssets && sourceAssets.length > 0) {
@@ -720,90 +704,34 @@ app.post("/api/generate-collage", async (req, res) => {
     
     parts.push({ text: finalPrompt });
 
-    const models = selectedModel === "nano-banana-2-lite"
-      ? ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"]
-      : (selectedModel === "nano-banana-2"
-        ? ["gemini-3.1-flash-image", "gemini-3-pro-image"]
-        : ["gemini-3-pro-image", "gemini-3.1-flash-image"]);
-
-    let rawImageBase64: string | null = null;
-    let lastError: any = null;
-
-    for (const modelName of models) {
-      try {
-        console.log(`[PROXY] Attempting collage generation with model: ${modelName}`);
-        const response = await ai.models.generateContent({
-          model: modelName,
-          contents: { parts },
-          config: {
-            temperature: tempVal,
-            systemInstruction: systemInstruction,
-            imageConfig: buildImageConfig(modelName, ratio, quality, tempVal)
-          }
-        });
-
-        for (const part of response.candidates?.[0]?.content?.parts || []) {
-          if (part.inlineData) {
-            rawImageBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
-            break;
-          }
-        }
-
-        if (rawImageBase64) {
-          break;
-        }
-
-        const textPart = response.candidates?.[0]?.content?.parts?.find(p => p.text);
-        const finishReason = response.candidates?.[0]?.finishReason;
-        let errorMsg = `Model ${modelName} returned no image.`;
-        if (textPart?.text) {
-          errorMsg += ` Refusal: ${textPart.text.slice(0, 200)}`;
-        }
-        if (finishReason && finishReason !== "STOP") {
-          errorMsg += ` Finish Reason: ${finishReason}`;
-        }
-        lastError = new Error(errorMsg);
-
-      } catch (err: any) {
-        console.warn(`[PROXY] Model ${modelName} failed:`, err);
-        lastError = err;
-      }
-    }
-
-    if (!rawImageBase64) {
-      const errorMsg = lastError?.message || lastError?.toString() || "Unknown reason";
-      return res.status(500).json({ error: errorMsg });
-    }
-
-    return res.json({ rawImageBase64 });
-  } catch (error: any) {
-    console.error("[PROXY ERROR] generate-collage failed:", error);
-    return res.status(500).json({ error: error?.message || error?.toString() });
+    const prepared = prepareAppImage({
+      appModelId: String(selectedModel ?? ""),
+      parts,
+      systemInstruction,
+      ratio: String(ratio),
+      temperature,
+    });
+    await streamImageResponse(res, async (signal) => ({ rawImageBase64: await runAppImage(prepared, signal) }), imageErrorBody);
+  } catch (error) {
+    sendImageError(res, "generate-collage", error);
   }
 });
 
 // API: Process Local Mask-based/Reflective Image Editing via Tokyo Cloud Run server proxy
 app.post("/api/edit-image", async (req, res) => {
   try {
-    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
-    if (!apiKey) {
-      return res.status(401).json({ error: "Missing backend Gemini API Key" });
-    }
-
     const {
       imageUrl,
       maskBase64,
       prompt,
       isMultiMask,
       selectedModel,
+      sourceAspect,
       temperature,
       extraImageBase64
     } = req.body;
 
-    const tempVal = typeof temperature === 'number' && !isNaN(temperature) ? temperature : 0.7;
-
-    const ai = new GoogleGenAI({ apiKey });
-    const parts: any[] = [];
+    const parts: ImagePart[] = [];
     
     const systemInstruction = `
       ROLE: Expert Professional Photo Retoucher.
@@ -826,16 +754,6 @@ app.post("/api/edit-image", async (req, res) => {
       }
     });
 
-    if (extraImageBase64) {
-      const extraAsset = await urlToAsset(extraImageBase64);
-      parts.push({
-        inlineData: {
-          data: extraAsset.data,
-          mimeType: extraAsset.mimeType
-        }
-      });
-    }
-
     if (maskBase64) {
       const maskAsset = await urlToAsset(maskBase64);
       parts.push({
@@ -887,65 +805,28 @@ app.post("/api/edit-image", async (req, res) => {
       parts.push({ text: `Global Edit Instruction: ${prompt}. \n\nEnsure the result maintains the high quality and resolution of the original image.` });
     }
 
-    const models = selectedModel === "nano-banana-2-lite"
-      ? ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"]
-      : (selectedModel === "nano-banana-2"
-        ? ["gemini-3.1-flash-image", "gemini-3-pro-image"]
-        : ["gemini-3-pro-image", "gemini-3.1-flash-image"]);
-
-    let rawImageBase64: string | null = null;
-    let lastError: any = null;
-
-    for (const modelName of models) {
-      try {
-        console.log(`[PROXY] Attempting edit layout with model: ${modelName}`);
-        const response = await ai.models.generateContent({
-          model: modelName,
-          contents: { parts },
-          config: {
-            temperature: tempVal,
-            systemInstruction,
-            imageConfig: buildImageConfig(modelName, undefined, undefined, tempVal)
-          }
-        });
-
-        for (const part of response.candidates?.[0]?.content?.parts || []) {
-          if (part.inlineData) {
-            rawImageBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
-            break;
-          }
-        }
-
-        if (rawImageBase64) {
-          break;
-        }
-
-        const textOutput = response.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
-        const finishReason = response.candidates?.[0]?.finishReason;
-        let errorMsg = `Model ${modelName} returned no image in edit.`;
-        if (textOutput) {
-          errorMsg += ` Refusal/Text: ${textOutput.slice(0, 200)}`;
-        }
-        if (finishReason && finishReason !== "STOP") {
-          errorMsg += ` Finish Reason: ${finishReason}`;
-        }
-        lastError = new Error(errorMsg);
-
-      } catch (err: any) {
-        console.warn(`[PROXY] Model ${modelName} edit failed:`, err);
-        lastError = err;
-      }
-    }
-
-    if (!rawImageBase64) {
-      const errorMsg = lastError?.message || lastError?.toString() || "Unknown reason";
-      return res.status(500).json({ error: errorMsg });
-    }
-
-    return res.json({ rawImageBase64 });
-  } catch (error: any) {
-    console.error("[PROXY ERROR] edit-image failed:", error);
-    return res.status(500).json({ error: error?.message || error?.toString() });
+    // Fixed reference order: Image 1 base, Image 2 mask (when present), then the extra reference.
+    if (extraImageBase64) {
+      const extraAsset = await urlToAsset(extraImageBase64);
+      const extraIndex = maskBase64 ? 3 : 2;
+      parts.push({ text: `Image ${extraIndex}: Additional reference asset supplied by the user for the requested change. Use it only as a visual reference; it is not a mask.` });
+      parts.push({ inlineData: { data: extraAsset.data, mimeType: extraAsset.mimeType } });
+    }
+
+    const appModelId = String(selectedModel ?? "");
+    const prepared = prepareAppImage({
+      appModelId,
+      parts,
+      systemInstruction,
+      // The input image's "width:height"; needed only by models that cannot keep the input aspect.
+      ratio: typeof sourceAspect === "string" ? sourceAspect : undefined,
+      keepInputAspect: true,
+      // Explicit edit temperatures (logo replacement uses 0.5) are validated; otherwise 0.7 where supported.
+      temperature: temperature ?? (imageModelView(appModelId)?.temperature ? EDIT_TEMPERATURE : undefined),
+    });
+    await streamImageResponse(res, async (signal) => ({ rawImageBase64: await runAppImage(prepared, signal) }), imageErrorBody);
+  } catch (error) {
+    sendImageError(res, "edit-image", error);
   }
 });
 
```


## Step 5: stop exposing the key to the browser (`vite.config.ts`)

```diff
diff --git a/vite.config.ts b/vite.config.ts
index ee5fb8d..f82d472 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -1,19 +1,15 @@
 import path from 'path';
-import { defineConfig, loadEnv } from 'vite';
+import { defineConfig } from 'vite';
 import react from '@vitejs/plugin-react';
 
-export default defineConfig(({ mode }) => {
-    const env = loadEnv(mode, '.', '');
+export default defineConfig(() => {
     return {
       server: {
         port: 3000,
         host: '0.0.0.0',
       },
       plugins: [react()],
-      define: {
-        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
-        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
-      },
+      // No `define` for API keys: provider keys stay on the server (server.ts reads process.env).
       resolve: {
         alias: {
           '@': path.resolve(__dirname, '.'),
```


## Step 6: check Part 1

Run `npm run lint`. It must pass. Then reply with the list of files you created or changed.
