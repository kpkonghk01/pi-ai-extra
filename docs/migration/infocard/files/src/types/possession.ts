/** Image model id from GET /api/image-models (server/imageModels.ts). */
export type PossessionImageModel = string;
export type PossessionTextModel = 'gemini-3.8-flash' | 'gemini-3.1-flash-lite';
export type PossessionRatio = '16:9' | '4:5' | '3:4' | '1:1' | '9:16';
export type PossessionResolution = '1K';

export interface ExtractedMaterialAnalysis {
  mainTitle: string;
  subtitle: string;
  badges: string[];
  detectedTextList: string[];
  characters: string;
  products: string;
  lightingVibe: string;
}

export interface PossessionHistoryItem {
  id: string;
  timestamp: number;
  templateUrl: string;
  materialUrl: string;
  generatedUrl: string;
  mainTitle: string;
  subtitle: string;
  badges: string[];
  ratio: PossessionRatio;
  model: PossessionImageModel;
}

export interface PossessionState {
  templateImage: string | null;
  materialImage: string | null;
  brandLogo: string | null;
  lockBrandLogo: boolean;
  lockFacialIdentity: boolean;
  lockProductDetails: boolean;
  eraseTemplateSubject: boolean;
  
  // LLM Extracted content
  mainTitle: string;
  subtitle: string;
  badges: string[];
  detectedTextList: string[];
  
  // Subject Analysis
  characterFeatures: string;
  productFeatures: string;
  lightingVibe: string;
  
  // Generation Settings
  customPrompt: string;
  selectedRatio: PossessionRatio;
  selectedImageModel: PossessionImageModel;
  selectedTextModel: PossessionTextModel;
  
  // Results & History
  currentResultUrl: string | null;
  history: PossessionHistoryItem[];
  
  // Slider view state
  compareMode: 'material-vs-result' | 'template-vs-result' | 'tri-view';
  sliderPosition: number; // 0 to 100
}

export const defaultPossessionState: PossessionState = {
  templateImage: null,
  materialImage: null,
  brandLogo: null,
  lockBrandLogo: true,
  lockFacialIdentity: true,
  lockProductDetails: true,
  eraseTemplateSubject: true,
  
  mainTitle: '',
  subtitle: '',
  badges: [],
  detectedTextList: [],
  
  characterFeatures: '',
  productFeatures: '',
  lightingVibe: '',
  
  customPrompt: '',
  selectedRatio: '16:9',
  selectedImageModel: 'nano-banana-2',
  selectedTextModel: 'gemini-3.8-flash',
  
  currentResultUrl: null,
  history: [],
  
  compareMode: 'material-vs-result',
  sliderPosition: 50,
};
