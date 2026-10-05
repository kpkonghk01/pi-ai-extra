import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
import { TitleSet, InfoCardRatio, InfoCardResolution, InfoCardModel, InfoCardTextModel } from '../types/infocard';

export interface AnalyzeArticleResponse {
  extractedArticle: {
    title: string;
    content: string;
  };
  coverTags?: string;
  titleSets: TitleSet[];
  recommendedIndex: number;
  contentCardsBreakdown: {
    cardIndex: number;
    subTitle: string;
    minorTitle: string;
    bodyParagraph: string;
    imagePrompt: string;
    tags: string;
  }[];
}

export const analyzeArticle = async (params: {
  url?: string;
  rawText?: string;
  textModel: InfoCardTextModel;
  maxTitleChars: { main: number; sub: number; minor: number };
  wordsPerCard: number;
  targetCardCount: number;
  autoDetectCardCount: boolean;
  language?: 'tc' | 'sc';
}): Promise<AnalyzeArticleResponse> => {
  const response = await fetch('/api/infocard/analyze-article', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `文章解析失敗 (${response.status})`);
  }

  return await response.json();
};

export interface GenerateCardParams {
  cardType: 'cover' | 'content';
  cardIndex?: number;
  templateImage: string;
  sourceImages?: string[];
  imagePrompt?: string;
  brandLogo?: string | null;
  mainTitle?: string;
  subTitle?: string;
  minorTitle?: string;
  bodyParagraph?: string;
  tags?: string;
  eraseTemplateText?: boolean;
  lockBrandLogo?: boolean;
  forbidPretrainedLogo?: boolean;
  forbidHallucinatedText?: boolean;
  ratio: InfoCardRatio;
  resolution: InfoCardResolution;
  modelId: InfoCardModel;
  language?: 'tc' | 'sc';
}

export const generateCardImage = async (params: GenerateCardParams, signal?: AbortSignal): Promise<string> => {
  const data = await postImageRequest('/api/infocard/generate-card', params, signal);
  return data.imageUrl;
};
