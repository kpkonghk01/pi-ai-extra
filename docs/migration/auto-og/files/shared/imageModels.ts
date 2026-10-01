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

/** One entry of GET /api/image-models. */
export interface ImageModelView {
  id: string;
  label: string;
  description: string;
  provider: ImageProvider;
  providerLabel: string;
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
