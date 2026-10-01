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
