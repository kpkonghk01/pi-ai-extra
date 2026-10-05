import { get, set } from 'idb-keyval';

export interface GeneratedImage {
  id: string;
  url: string;
  ratio: string;
  timestamp: number;
  /** Estimated HK$, or UNPRICED_COST_HKD (-1) when the model has no verified price. */
  costHKD: number;
  model: string;
  resolution?: '1K' | '2K';
}

export interface TemplateSet {
  id: string;
  name: string;
  images: string[];
}

export interface AppState {
  templateImage: string | null;
  templateImages: string[];
  activeTemplateIndex: number;
  templateSets: TemplateSet[];
  eraseTemplateSubject?: boolean;
  lockBrandLogo?: boolean;
  temperature?: number;
  aiMatting?: boolean;
  forbidPretrainedKnowledge?: boolean;
  imageResolution?: '1K' | '2K';
  sourceImages: string[];
  brandLogo: string | null;
  globalPrompt: string;
  selectedRatios: string[];
  ratioPrompts: Record<string, string>;
  /** Image model id from GET /api/image-models; an unknown saved id is reset by the selector. */
  selectedModel: string;
  history: GeneratedImage[];
}

const defaultTemplateSets: TemplateSet[] = [
  { id: 'set-1', name: '組合 1', images: [] },
  { id: 'set-2', name: '組合 2', images: [] },
  { id: 'set-3', name: '組合 3', images: [] },
  { id: 'set-4', name: '組合 4', images: [] },
  { id: 'set-5', name: '組合 5', images: [] },
];

const defaultState: AppState = {
  templateImage: null,
  templateImages: [],
  activeTemplateIndex: 0,
  templateSets: defaultTemplateSets,
  eraseTemplateSubject: true,
  lockBrandLogo: true,
  temperature: 0.7,
  aiMatting: false,
  forbidPretrainedKnowledge: true,
  imageResolution: '1K',
  sourceImages: [],
  brandLogo: null,
  globalPrompt: '',
  selectedRatios: ['16:9'],
  ratioPrompts: {},
  selectedModel: 'nano-banana-2',
  history: [],
};

export const loadState = async (): Promise<AppState> => {
  try {
    const saved = await get('og-master-state');
    if (saved) {
      const state: AppState = { ...defaultState, ...saved };
      if (state.imageResolution === undefined) {
        state.imageResolution = '1K';
      }
      if (state.eraseTemplateSubject === undefined) {
        state.eraseTemplateSubject = true;
      }
      if (state.lockBrandLogo === undefined) {
        state.lockBrandLogo = true;
      }
      if (state.temperature === undefined) {
        state.temperature = 0.7;
      }
      if (state.aiMatting === undefined) {
        state.aiMatting = false;
      }
      if (state.forbidPretrainedKnowledge === undefined) {
        state.forbidPretrainedKnowledge = true;
      }

      // Ensure templateImages and activeTemplateIndex migration
      if ((!state.templateImages || state.templateImages.length === 0) && state.templateImage) {
        state.templateImages = [state.templateImage];
        state.activeTemplateIndex = 0;
      } else if (!state.templateImages) {
        state.templateImages = [];
        state.activeTemplateIndex = 0;
      }

      if (state.templateImages.length > 0) {
        const idx = Math.min(state.activeTemplateIndex ?? 0, state.templateImages.length - 1);
        state.activeTemplateIndex = Math.max(0, idx);
        state.templateImage = state.templateImages[state.activeTemplateIndex] || null;
      } else {
        state.templateImage = null;
        state.activeTemplateIndex = 0;
      }

      // Ensure 5 template sets
      if (!state.templateSets || !Array.isArray(state.templateSets) || state.templateSets.length === 0) {
        state.templateSets = defaultTemplateSets;
      } else {
        const sets = [...state.templateSets];
        for (let i = sets.length; i < 5; i++) {
          sets.push({ id: `set-${i + 1}`, name: `組合 ${i + 1}`, images: [] });
        }
        state.templateSets = sets.slice(0, 5);
      }

      // Filter out unsupported ratios
      const validRatios = ['16:9', '4:5', '1:1', '9:16', '300x250', '300x300', '336x280', '300x600', '320x480'];
      state.selectedRatios = state.selectedRatios.filter((r: string) => validRatios.includes(r));
      if (state.selectedRatios.length === 0) {
        state.selectedRatios = ['16:9'];
      }
      return state;
    }
  } catch (e) {
    console.error('Failed to load state', e);
  }
  return defaultState;
};

export const saveState = async (state: AppState) => {
  try {
    await set('og-master-state', state);
  } catch (e) {
    console.error('Failed to save state', e);
  }
};
