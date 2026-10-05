export type InfoCardMode = 'manual' | 'semi-auto' | 'full-auto';
export type InfoCardRatio = '4:5' | '9:16' | '1:1' | '3:4';
export type InfoCardResolution = '1K' | '2K';
/** Image model id from GET /api/image-models (server/imageModels.ts). */
export type InfoCardModel = string;
export type InfoCardTextModel = 'gemini-3.8-flash' | 'gemini-3.5-flash-lite';

export interface TitleSet {
  id: string;
  mainTitle: string;
  subTitle: string;
  minorTitle: string;
  tags?: string;
}

export interface TemplatePairSet {
  id: string;
  name: string;
  coverTemplate: string | null;
  contentTemplate: string | null;
  updatedAt?: number;
}

export interface CoverCardState {
  templateImage: string | null;
  sourceImages: string[];
  imagePrompt: string;
  mainTitle: string;
  subTitle: string;
  minorTitle: string;
  tags: string;
  eraseTemplateText: boolean;
  lockBrandLogo: boolean;
  forbidPretrainedLogo: boolean;
  forbidHallucinatedText: boolean;
  resultImage: string | null;
  isGenerating: boolean;
}

export interface ContentCardItem {
  id: string;
  cardIndex: number;
  sourceImages: string[];
  imagePrompt: string;
  mainTitle: string;
  subTitle: string;
  minorTitle: string;
  bodyParagraph: string;
  tags: string;
  eraseTemplateText: boolean;
  lockBrandLogo: boolean;
  forbidPretrainedLogo: boolean;
  forbidHallucinatedText: boolean;
  resultImage: string | null;
  isGenerating: boolean;
}

export interface InfoCardState {
  mode: InfoCardMode;
  selectedModel: InfoCardModel;
  selectedTextModel: InfoCardTextModel;
  selectedRatio: InfoCardRatio;
  selectedResolution: InfoCardResolution;
  templatePairSets: TemplatePairSet[];
  activePairSetIndex: number | null;
  contentTemplateImage: string | null;
  coverCard: CoverCardState;
  contentCards: ContentCardItem[];
  articleUrl: string;
  rawArticleText: string;
  extractedArticle: {
    title: string;
    content: string;
  } | null;
  generatedTitleSets: TitleSet[];
  isTitleSetsExpanded: boolean;
  selectedTitleSetIndex: number;
  reviewedTitles: {
    mainTitle: string;
    subTitle: string;
    minorTitle: string;
  };
  titleCharLimits: {
    main: number;
    sub: number;
    minor: number;
  };
  wordsPerCard: number;
  targetCardCount: number;
  autoDetectCardCount: boolean;
  brandLogo: string | null;
}
