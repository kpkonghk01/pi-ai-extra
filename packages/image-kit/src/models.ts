/**
 * Types and pure helpers shared by the server (`/server`) and the browser (`/browser`, `/react`).
 * No provider package is imported here, so this entry is safe in the browser bundle.
 */

export type ImageProvider = 'google' | 'kie' | 'toapis';

export type OutputResolution = '1K' | '2K' | '4K';

/**
 * Resolutions that only models listing them can serve. Any other resolution is best effort:
 * a model without that option gets its default size and the app resizes the result.
 */
export const STRICT_RESOLUTIONS: readonly OutputResolution[] = ['4K'];

/** How well a model follows a colour-stroke or mask image that is sent as a reference image. */
export type MaskEditing = 'supported' | 'reference-only';

/** App-maintained price estimate; never a provider-reported usage record. */
export interface PriceEstimate {
  /** USD per generated image, by requested resolution. A missing resolution has no known price. */
  perImageUsd: Partial<Record<OutputResolution, number>>;
  /** USD per 1M input tokens; 0 when the per-image price already includes input. */
  inputPerMillionTokensUsd: number;
}

/** Error fields returned for failed image requests and shown by the ErrorPanel. */
export interface ImageErrorDetails {
  appModelId?: string;
  provider?: string;
  model?: string;
  code?: string;
  status?: number;
  taskId?: string;
  providerCode?: string;
}

/** One entry of GET /api/image-models, keyed by canonical provider family ID. */
export interface ImageModelView {
  /** Canonical `provider:familyId`, stored by consumer UI state. */
  id: string;
  label: string;
  description: string;
  provider: ImageProvider;
  providerLabel: string;
  /** Provider model operation used with reference images. */
  providerModel: string;
  /** Reference image types the model accepts. */
  acceptedMimeTypes: string[];
  /** Reference images the model accepts; max null = no documented limit. */
  referenceLimit: { min: number; max: number | null };
  /** Accepted temperature range, or null when the model does not accept temperature. */
  temperature: { min: number; max: number } | null;
  /** Resolutions the model can be asked for; empty when the model has no resolution option. */
  resolutions: OutputResolution[];
  maskEditing: MaskEditing;
  /** Null when no verified price is known; the UI shows "—". */
  price: PriceEstimate | null;
  /** False when the server has no key for this provider or the package lacks the model. */
  available: boolean;
  unavailableReason: string | null;
}

/** What the next request needs from the selected model. */
export interface ModelNeeds {
  /** Reference images the request will send (templates, sources, logos, masks). */
  referenceCount: number;
  resolution?: OutputResolution | undefined;
}

export const TEMPERATURE_SUPPORT_NOTE =
  'Temperature 只適用於 catalogue 列出 temperature 範圍的模型；其他模型不支援此設定。';

export const MASK_REFERENCE_ONLY_NOTE =
  '此模型以參考圖方式理解遮罩或筆劃，局部編輯可能影響標記以外的範圍；需要精準局部修改時建議使用 Nano Banana 系列。';

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

/** Why `model` cannot serve `resolution`, or null when it can (strict resolutions only). */
export function resolutionIssue(model: ImageModelView, resolution: OutputResolution | undefined): string | null {
  if (resolution === undefined || !STRICT_RESOLUTIONS.includes(resolution)) return null;
  return model.resolutions.includes(resolution) ? null : `不支援 ${resolution}`;
}

/** Why `model` cannot be used right now (missing key, too many images, resolution), or null. */
export function modelIssue(model: ImageModelView, needs: ModelNeeds): string | null {
  if (!model.available) return model.unavailableReason ?? '此模型目前不可用';
  return referenceIssue(model, needs.referenceCount) ?? resolutionIssue(model, needs.resolution);
}

/**
 * modelIssue() for the selected model, where undefined means the model list has not loaded (or
 * failed to load). Generation waits for the list, so temperature and prices are known.
 */
export function selectedModelIssue(model: ImageModelView | undefined, needs: ModelNeeds): string | null {
  return model ? modelIssue(model, needs) : '圖片模型清單尚未載入';
}

/** Reference images that still fit after `used` are taken (Infinity when there is no limit). */
export function remainingReferenceCapacity(model: ImageModelView, used: number): number {
  return model.referenceLimit.max === null ? Number.POSITIVE_INFINITY : Math.max(0, model.referenceLimit.max - used);
}

/** Rough input token count used by the estimates (258 tokens per image, 4 characters per token). */
export function estimateInputTokens(inputImages: number, promptChars: number): number {
  return Math.ceil(inputImages * 258 + promptChars * 0.25);
}

/** Estimated USD for one generated image, or null when the model's price at `resolution` is unknown. */
export function estimateImageCostUsd(
  model: ImageModelView | undefined,
  input: { resolution: OutputResolution; inputImages: number; promptChars: number },
): number | null {
  const price = model?.price;
  const perImage = price?.perImageUsd[input.resolution];
  if (!price || perImage === undefined) return null;
  return perImage + (estimateInputTokens(input.inputImages, input.promptChars) / 1_000_000) * price.inputPerMillionTokensUsd;
}

/** Width / height of "W:H" or "WxH" (for example "16:9", "300x250"); undefined when unparseable or not positive. */
export function ratioValue(ratio: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)\s*$/i.exec(ratio);
  if (!match) return undefined;
  const value = Number(match[1]) / Number(match[2]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
