import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
import {
  PossessionImageModel,
  PossessionTextModel,
  PossessionRatio,
  ExtractedMaterialAnalysis,
} from '../types/possession';

export const extractMaterialAnalysis = async (params: {
  materialImage: string;
  textModel?: PossessionTextModel;
  language?: 'tc' | 'sc';
}): Promise<ExtractedMaterialAnalysis> => {
  const response = await fetch('/api/possession/extract-material', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `素材文字與特徵提取失敗 (${response.status})`);
  }

  return await response.json();
};

export interface GeneratePossessionParams {
  templateImage: string;
  materialImage: string;
  brandLogo?: string | null;
  lockBrandLogo?: boolean;
  lockFacialIdentity?: boolean;
  lockProductDetails?: boolean;
  eraseTemplateSubject?: boolean;
  mainTitle?: string;
  subtitle?: string;
  badges?: string[];
  detectedTextList?: string[];
  customPrompt?: string;
  ratio?: PossessionRatio;
  imageModel?: PossessionImageModel;
  language?: 'tc' | 'sc';
}

export const generatePossessionOg = async (
  params: GeneratePossessionParams,
  signal?: AbortSignal
): Promise<{ imageUrl: string; metadata?: any }> => {
  return await postImageRequest('/api/possession/generate', params, signal);
};
