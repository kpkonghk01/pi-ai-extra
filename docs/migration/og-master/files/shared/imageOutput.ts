import type { AspectRatio } from '../types';

/**
 * Final output size for each ratio preset, and the generation resolution that covers it.
 * Shared by the server (what to request) and the browser (cost estimates).
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
  '300x300': { width: 300, height: 300, resolution: '1K' },
};

const FALLBACK_SPEC: OutputSpec = { width: 1024, height: 1024, resolution: '1K' };

export function outputSpec(ratio: string): OutputSpec {
  return OUTPUT_SPECS[ratio as AspectRatio] ?? FALLBACK_SPEC;
}
