export type ModelProvider = 'gemini' | 'toapis' | 'openrouter' | 'kie' | 'wokey';

export interface ModelConfig {
  id: string;
  label: string;
  description: string;
  provider: ModelProvider;
  costUSD: number;
  costHKD?: number;
  apiModelName?: string; // Optional remote model identifier override
  enabled?: boolean;
}

export const PROVIDER_GROUP_LABELS: Record<ModelProvider, string> = {
  gemini: 'Google Gemini',
  wokey: 'Wokey 提供',
  toapis: 'ToAPIs 提供',
  kie: 'KIE 提供',
  openrouter: 'OpenRouter 提供',
};

export const MODELS_CONFIG: ModelConfig[] = [
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    description: '預設模型，生成速度快，適合一般拼貼。',
    provider: 'gemini',
    costUSD: 0.03, // Standard base tier (approx HK$ 0.23)
    enabled: true,
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    description: '進階模型，細節更豐富，適合高要求圖片。',
    provider: 'gemini',
    costUSD: 0.05, // Pro tier (approx HK$ 0.39)
    enabled: true,
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare (ToAPIs)',
    description: 'ToAPIs 提供之 GPT-Image-2.5-Flare，支援樣板參考圖輸入（若遇 ToAPIs 渠道暫時熔斷將自動平滑轉由 GPT Image 2 完成）。',
    provider: 'toapis',
    costUSD: 0.015,
    costHKD: 0.12,
    apiModelName: 'gpt-image-2.5-flare',
    enabled: true,
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst (ToAPIs)',
    description: 'ToAPIs 提供之 GPT-Image-2.5-Sunburst，支援樣板參考圖輸入與 1K/2K 高解析度（若遇渠道暫時熔斷將自動平滑切換）。',
    provider: 'toapis',
    costUSD: 0.015,
    costHKD: 0.12,
    apiModelName: 'gpt-image-2.5-sunburst',
    enabled: true,
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (ToAPIs)',
    description: 'ToAPIs 提供之 GPT 圖片模型，高創意度與畫面品質。',
    provider: 'toapis',
    costUSD: 0.08, // HK$ 0.62
    apiModelName: 'gpt-image-2',
    enabled: true,
  },
  {
    id: 'doubao-seedream-5-0-pro',
    label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
    description: 'ByteDance 豆包最新 Seedream 5.0 圖像模型，支援 2K/3K 超高畫質與強大畫面表現力。',
    provider: 'toapis',
    costUSD: 0.05, // HK$ 0.39
    apiModelName: 'doubao-seedream-5-0-pro',
    enabled: true,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 Preview (ToAPIs)',
    description: 'ToAPIs 提供之 Gemini 3.1 Flash Preview 圖像模型，輕量極速（約 20~25 秒完成），兼具優良畫質與響應速度。',
    provider: 'toapis',
    costUSD: 0.03, // HK$ 0.23
    apiModelName: 'gemini-3.1-flash-image-preview',
    enabled: true,
  },
  {
    id: 'kie-grok-imagine-2',
    label: 'Grok Imagine 2.0 (KIE)',
    description: 'KIE 提供之 xAI Grok Imagine 2.0，支援文生圖與圖片編輯（約 HK$ 0.16）。',
    provider: 'kie',
    costUSD: 0.02,
    costHKD: 0.16,
    apiModelName: 'grok-imagine-image-2-0/text-to-image',
    enabled: true,
  },
  {
    id: 'kie-gpt-image-2',
    label: 'GPT Image 2 (KIE)',
    description: 'KIE 提供之 GPT Image 2 圖像模型，高細緻度與真實感（約 HK$ 0.15）。',
    provider: 'kie',
    costUSD: 0.02,
    costHKD: 0.15,
    apiModelName: 'gpt-image-2-text-to-image',
    enabled: true,
  },
  {
    id: 'kie-nano-banana-2',
    label: 'Nano Banana 2 (KIE)',
    description: 'KIE 提供之 Google Nano Banana 2 圖像模型，生成迅速反應快（約 HK$ 0.25）。',
    provider: 'kie',
    costUSD: 0.032,
    costHKD: 0.25,
    apiModelName: 'nano-banana-2',
    enabled: true,
  },
  {
    id: 'wokey-gpt-image-2.5',
    label: 'GPT Image 2.5 (Wokey)',
    description: 'Wokey 提供之 GPT Image 2.5 圖像模型（超高性價比，約 HK$ 0.08 / 張）。',
    provider: 'wokey',
    costUSD: 0.01,
    costHKD: 0.08,
    apiModelName: 'gpt-image-2.5',
    enabled: false,
  },
  {
    id: 'wokey-grok-imagine-2',
    label: 'Grok Image 2 (Wokey)',
    description: 'Wokey 提供之 xAI Grok Image 2 圖像模型（約 HK$ 0.08 / 張）。',
    provider: 'wokey',
    costUSD: 0.01,
    costHKD: 0.08,
    apiModelName: 'grok-imagine-image-2.0',
    enabled: false,
  },
  {
    id: 'qwen-image-3.0-pro',
    label: 'Qwen Image 3.0 Pro (ToAPIs)',
    description: 'Qwen 3.0 旗艦圖像模型，畫面構圖與中文排版極為細緻出色，但生成需時約 2~3 分鐘（耗時較長）。',
    provider: 'toapis',
    costUSD: 0.06,
    apiModelName: 'qwen-image-3.0-pro',
    enabled: false, // Commented out by default
  },
  {
    id: 'openrouter-gpt-image-2',
    label: 'GPT Image 2 (OpenRouter)',
    description: 'OpenRouter 提供之 GPT Image 2 圖片模型。',
    provider: 'openrouter',
    costUSD: 0.08,
    enabled: false, // Commented out by default
  },
];

// Active models shown in UI dropdown
export const ACTIVE_MODELS = MODELS_CONFIG.filter((m) => m.enabled !== false);

// Helper to look up model configuration by ID
export const getModelConfig = (modelId?: string | null): ModelConfig | undefined => {
  if (!modelId || typeof modelId !== 'string') return undefined;
  return MODELS_CONFIG.find((m) => m.id === modelId || m.apiModelName === modelId);
};

// Check if a model uses ToAPIs
export const isToapisModel = (modelId?: string | null): boolean => {
  if (!modelId || typeof modelId !== 'string') return false;
  const model = getModelConfig(modelId);
  return (
    model?.provider === 'toapis' ||
    modelId === 'gpt-image-2.5-flare' ||
    modelId === 'gpt-image-2.5-sunburst' ||
    modelId === 'gpt-image-2' ||
    modelId === 'doubao-seedream-5-0-pro' ||
    modelId === 'gemini-3.1-flash-image-preview' ||
    modelId === 'qwen-image-3.0-pro'
  );
};

// Check if a model uses OpenRouter
export const isOpenRouterModel = (modelId?: string | null): boolean => {
  if (!modelId || typeof modelId !== 'string') return false;
  const model = getModelConfig(modelId);
  return model?.provider === 'openrouter' || modelId === 'openrouter-gpt-image-2';
};

// Check if a model uses KIE
export const isKieModel = (modelId?: string | null): boolean => {
  if (!modelId || typeof modelId !== 'string') return false;
  const model = getModelConfig(modelId);
  return (
    model?.provider === 'kie' ||
    modelId.startsWith('kie-') ||
    modelId.includes('grok-imagine') ||
    modelId === 'gpt-image-2-text-to-image' ||
    modelId === 'gpt-image-2-image-to-image'
  );
};

// Check if a model uses Wokey
export const isWokeyModel = (modelId?: string | null): boolean => {
  if (!modelId || typeof modelId !== 'string') return false;
  const model = getModelConfig(modelId);
  return (
    model?.provider === 'wokey' ||
    modelId.startsWith('wokey-') ||
    modelId === 'gpt-image-2.5-wokey' ||
    modelId === 'grok-imagine-image-2.0-wokey'
  );
};

// Get label for display in token history and lists
export const getModelLabel = (modelId?: string | null): string => {
  if (!modelId || typeof modelId !== 'string') return 'Nano Banana 2';
  const found = getModelConfig(modelId);
  if (found) return found.label;
  if (modelId === 'nano-banana-pro') return 'Nano Banana Pro';
  if (modelId === 'nano-banana-2') return 'Nano Banana 2';
  return modelId;
};
