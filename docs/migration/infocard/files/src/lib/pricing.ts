import { estimateImageCostUsd, type ImageModelView, type OutputResolution } from '@hk01/pi-ai-extra-image-kit';

const EXCHANGE_RATE = 7.78;

/**
 * Stored as costHKD when the model has no verified price. History documents must keep a numeric
 * costHKD (Firestore rules), so unpriced images use this marker and totals skip them.
 */
export const UNPRICED_COST_HKD = -1;

/** Estimated HK$ for one image from the model's verified price, or UNPRICED_COST_HKD. */
export const calculateCost = (
  model: ImageModelView | undefined,
  input: { resolution: OutputResolution; inputImages: number; promptChars: number }
): number => {
  const usd = estimateImageCostUsd(model, input);
  return usd === null ? UNPRICED_COST_HKD : usd * EXCHANGE_RATE;
};

export const isPriced = (costHKD: number): boolean => costHKD >= 0;

/** "HK$ 0.52", or "—" for an unpriced image. */
export const formatCost = (costHKD: number): string => (isPriced(costHKD) ? `HK$ ${costHKD.toFixed(2)}` : '—');

/** Sum of the priced items and the number of unpriced ones. */
export const sumCosts = (costs: readonly number[]): { totalHKD: number; unpriced: number } => ({
  totalHKD: costs.filter(isPriced).reduce((sum, cost) => sum + cost, 0),
  unpriced: costs.filter((cost) => !isPriced(cost)).length,
});
