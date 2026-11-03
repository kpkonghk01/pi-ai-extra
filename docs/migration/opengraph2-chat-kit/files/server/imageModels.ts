import { createImageClient, type CataloguePolicy } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * opengraph2's catalogue policy and route-owned image clients. Every image model family in the
 * installed Google, ToAPIs and KIE packages is offered, so a provider package upgrade adds its new
 * families. Limits and capabilities come from the catalogues; this file only holds the app's own
 * labels, verified prices and mask-editing guidance.
 */

const POLICY: CataloguePolicy = {
  overrides: {
    'google:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1',
      description: 'Google 官方提供的旗艦圖片模型。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-30): $0.0336 / $0.0504 / $0.113 per 1K / 2K / 4K image, input $1.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.0336, '2K': 0.0504, '4K': 0.113 }, inputPerMillionTokensUsd: 1.5 },
    },
    'google:gemini-3-pro-image': {
      label: 'Nano Banana Pro',
      description: '細節更強，適合複雜佈局',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $2.00 / 1M tokens.
      price: { perImageUsd: { '1K': 0.134, '2K': 0.134 }, inputPerMillionTokensUsd: 2 },
    },
    'toapis:gpt-image-2.5-flare': {
      label: 'GPT Image 2.5 Flare (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Flare。',
      maskEditing: 'reference-only',
      // ToAPIs GPT Image 2.5 doc (2026-09-09).
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2.5-sunburst': {
      label: 'GPT Image 2.5 Sunburst (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。',
      maskEditing: 'reference-only',
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2': {
      label: 'GPT Image 2 (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2。',
      maskEditing: 'reference-only',
    },
    'toapis:doubao-seedream-5-0-pro': {
      label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
      description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。',
      maskEditing: 'reference-only',
    },
    'toapis:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1 (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini Nano Banana 2.1。',
      maskEditing: 'supported',
      // ToAPIs pricing API (2026-10-30): $0.015 per request at every resolution.
      price: { perImageUsd: { '1K': 0.015, '2K': 0.015, '4K': 0.015 }, inputPerMillionTokensUsd: 0 },
    },
    'kie:grok-imagine-image-2-0': {
      label: 'Grok Imagine 2.0 (KIE)',
      description: 'KIE 提供的 Grok Imagine 2.0。',
      maskEditing: 'reference-only',
    },
    'kie:gpt-image-2': {
      label: 'GPT Image 2 (KIE)',
      description: 'KIE 提供的 GPT Image 2。',
      maskEditing: 'reference-only',
    },
    'kie:nano-banana-2-1': {
      label: 'Nano Banana 2.1 (KIE)',
      description: 'KIE 提供的 Nano Banana 2.1，預設推薦。',
      maskEditing: 'supported',
      // kie.ai/pricing (2026-10-30): 4 / 6 / 9 credits per image.
      price: { perImageUsd: { '1K': 0.02, '2K': 0.03, '4K': 0.045 }, inputPerMillionTokensUsd: 0 },
    },
  },
  scopes: {
    generate: {},
    edit: {},
  },
};

export const imageClient = createImageClient({
  app: 'opengraph2',
  policy: POLICY,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const generateImages = imageClient.forScope('generate');
export const editImages = imageClient.forScope('edit');
