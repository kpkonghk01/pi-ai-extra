export type OutputResolution = '1K' | '2K' | '4K';
export interface ImageModelView {
  id: string;
  price: unknown;
}
export function estimateImageCostUsd(model: ImageModelView | undefined, input: { resolution: OutputResolution; inputImages: number; promptChars: number }): number | null;
