import { estimateImageCostUsd, type ImageModelView } from '@hk01/pi-ai-extra-image-kit';
import { outputSpec } from './imageOutput';

/**
 * og-master's own image-model constants and cost estimate. Model views, limits and the other
 * helpers come from @hk01/pi-ai-extra-image-kit. Safe in the browser bundle.
 */

export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';
export const USD_TO_HKD = 7.8;

/**
 * Estimated USD for one request per entry of `ratios`, or null when the model's price is unknown.
 * Each output image is its own request, so input tokens are counted once per image.
 */
export function estimateCostUsd(
  model: ImageModelView | undefined,
  input: { inputImages: number; promptChars: number; ratios: readonly string[] },
): number | null {
  if (!model?.price) return null;
  let total = 0;
  for (const ratio of input.ratios) {
    const cost = estimateImageCostUsd(model, {
      resolution: outputSpec(ratio).resolution,
      inputImages: input.inputImages,
      promptChars: input.promptChars,
    });
    if (cost === null) return null;
    total += cost;
  }
  return total;
}
