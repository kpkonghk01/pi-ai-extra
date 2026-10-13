import { createImageClient, type CataloguePolicy } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * og-master's catalogue policy and route-owned image clients. Every image model family in the
 * installed Google, ToAPIs and KIE packages is offered, so a provider package upgrade adds its new
 * families. Limits and capabilities come from the catalogues; this file only holds the app's own
 * labels, verified prices and mask-editing guidance (the same as Auto OG's).
 */

const POLICY: CataloguePolicy = {
  overrides: {
    'google:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1',
      description: 'Google 直連 Gemini Nano Banana 2.1，最新旗艦高效率生圖模型。',
      maskEditing: 'supported',
      price: { perImageUsd: { '1K': 0.034, '2K': 0.05 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3.1-flash-image': {
      label: 'Nano Banana 2（2代平衡）',
      description: 'Google 直連 Gemini 3.1 Flash Image，速度快，適合一般拼貼。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $0.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.067, '2K': 0.101 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3-pro-image': {
      label: 'Nano Banana Pro（Pro 思考）',
      description: 'Google 直連 Gemini 3 Pro Image，細節更豐富，適合高要求圖片。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $2.00 / 1M tokens.
      price: { perImageUsd: { '1K': 0.134, '2K': 0.134 }, inputPerMillionTokensUsd: 2 },
    },
    'toapis:gemini-3.1-flash-image-preview': {
      label: 'Nano Banana 2 Preview (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
      maskEditing: 'supported',
    },
    'toapis:gpt-image-2': { label: 'GPT Image 2 (ToAPIs)', description: 'ToAPIs 提供的 GPT Image 2。' },
    'toapis:gpt-image-2.5-flare': {
      label: 'GPT Image 2.5 Flare (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Flare。',
      // ToAPIs GPT Image 2.5 doc (2026-09-09).
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2.5-sunburst': {
      label: 'GPT Image 2.5 Sunburst (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。',
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:doubao-seedream-5-0-pro': { label: 'Seedream 5.0 Pro (ToAPIs)', description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。' },
    'kie:grok-imagine-image-2-0': { label: 'Grok Imagine 2.0 (KIE)', description: 'KIE 提供的 Grok Imagine 2.0。' },
    'kie:gpt-image-2': { label: 'GPT Image 2 (KIE)', description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。' },
    'kie:nano-banana-2': { label: 'Nano Banana 2 (KIE)', description: 'KIE 提供的 Gemini 3.1 Flash Image。', maskEditing: 'supported' },
  },
  scopes: {
    collage: {},
    edit: {},
  },
};

export const imageClient = createImageClient({
  app: 'og-master',
  policy: POLICY,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const collageImages = imageClient.forScope('collage');
export const editImages = imageClient.forScope('edit');
