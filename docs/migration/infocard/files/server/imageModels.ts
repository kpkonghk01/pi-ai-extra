import sharp from 'sharp';
import { createImageClient, type ImageModelOption, type ReferenceConverter } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * The image models InfoCard offers, in selector order (grouped like open-graph-single), and the
 * shared image client every image route uses. Limits and capabilities come from the package
 * catalogues through @hk01/pi-ai-extra-image-kit; this file only holds InfoCard's own choices.
 */

export const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';

const MODELS: readonly ImageModelOption[] = [
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    description: '預設模型，Google 直連 Gemini 3.1 Flash Image，生成速度快。',
    provider: 'google',
    model: 'gemini-3.1-flash-image',
    maskEditing: 'supported',
    // Google pricing page (2026-10-06): image output $60 / 1M tokens, input $0.50 / 1M tokens.
    price: { perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, inputPerMillionTokensUsd: 0.5 },
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    description: '進階模型，Google 直連 Gemini 3 Pro Image，細節更豐富。',
    provider: 'google',
    model: 'gemini-3-pro-image',
    maskEditing: 'supported',
    // Google pricing page (2026-10-06): image output $120 / 1M tokens, input $2.00 / 1M tokens.
    price: { perImageUsd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 }, inputPerMillionTokensUsd: 2 },
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Flare，支援參考圖輸入。',
    provider: 'toapis',
    model: 'gpt-image-2.5-flare',
    maskEditing: 'reference-only',
    // ToAPIs GPT Image 2.5 doc (verified 2026-09-09); reference images have no extra fee.
    price: { perImageUsd: { '1K': 0.015, '2K': 0.02, '4K': 0.025 }, inputPerMillionTokensUsd: 0 },
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst，支援參考圖輸入。',
    provider: 'toapis',
    model: 'gpt-image-2.5-sunburst',
    maskEditing: 'reference-only',
    price: { perImageUsd: { '1K': 0.015, '2K': 0.02, '4K': 0.025 }, inputPerMillionTokensUsd: 0 },
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2，高創意度與畫面品質。',
    provider: 'toapis',
    model: 'gpt-image-2',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'doubao-seedream-5-0-pro',
    label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
    description: 'ByteDance 豆包 Seedream 5.0 Pro，最高 2K；參考圖會轉為 PNG / JPEG 送出。',
    provider: 'toapis',
    model: 'doubao-seedream-5-0-pro',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 Preview (ToAPIs)',
    description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
    provider: 'toapis',
    model: 'gemini-3.1-flash-image-preview',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'kie-grok-imagine-2',
    label: 'Grok Imagine 2.0 (KIE)',
    description: 'KIE 提供的 xAI Grok Imagine 2.0；有參考圖時最多 5 張、prompt 上限 8,000 字元，沒有解像度選項。',
    provider: 'kie',
    model: 'grok-imagine-image-2-0/image-edit',
    textOnlyModel: 'grok-imagine-image-2-0/text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-gpt-image-2',
    label: 'GPT Image 2 (KIE)',
    description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。',
    provider: 'kie',
    model: 'gpt-image-2-image-to-image',
    textOnlyModel: 'gpt-image-2-text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-nano-banana-2',
    label: 'Nano Banana 2 (KIE)',
    description: 'KIE 提供的 Gemini 3.1 Flash Image。',
    provider: 'kie',
    model: 'nano-banana-2',
    maskEditing: 'supported',
    price: null,
  },
];

const JPEG_QUALITY = 90;
const MAX_SHRINK_ATTEMPTS = 6;

/**
 * Re-encodes a reference image that the selected model cannot take as is: an unsupported format
 * (WebP or GIF for Seedream) becomes PNG when it has transparency, otherwise JPEG, and an image
 * over the model's inline size limit is scaled down until it fits. EXIF rotation is applied.
 */
export const convertReference: ReferenceConverter = async (dataUrl, { acceptedMimeTypes, maxInlineBytes }) => {
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const metadata = await sharp(input).metadata();
  const asPng = Boolean(metadata.hasAlpha) && acceptedMimeTypes.includes('image/png');
  const mimeType = asPng ? 'image/png' : 'image/jpeg';
  let width = metadata.autoOrient?.width ?? metadata.width;
  for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt++) {
    const pipeline = sharp(input).rotate().resize({ width, withoutEnlargement: true });
    const output = await (asPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY })).toBuffer();
    if (output.length <= maxInlineBytes) return `data:${mimeType};base64,${output.toString('base64')}`;
    width = Math.floor((width ?? 4096) * Math.sqrt(maxInlineBytes / output.length) * 0.9);
  }
  throw new Error(`縮小 ${MAX_SHRINK_ATTEMPTS} 次後仍超過 ${(maxInlineBytes / 1_048_576).toFixed(0)} MB`);
};

export const imageClient = createImageClient({
  app: 'infocard',
  models: MODELS,
  env: process.env,
  // InfoCard has always also accepted TOAPI_API_KEY (without the S).
  secretNames: { toapis: ['TOAPIS_API_KEY', 'TOAPI_API_KEY'] },
  convertReference,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});
