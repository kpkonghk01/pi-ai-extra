/** Image model id from GET /api/image-models (server/imageModels.ts). */
export type BatchModelId = string;

export type BatchAspectRatio = '4:5' | '3:4' | 'original' | '1:1' | '16:9' | '9:16';

export type BatchResolution = '1K' | '2K' | '4K';

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface LogoConfig {
  logoUrl: string | null;
  position: LogoPosition;
  scale: number; // 5 to 35%
  opacity: number; // 20 to 100%
  enabled: boolean;
}

export interface BatchItem {
  id: string;
  originalUrl: string | null;
  currentUrl: string | null; // Active base image (changes upon iteration, null if text-to-image)
  generatedUrl: string | null;
  historyStack: string[]; // List of previous versions for undo/iteration
  dedicatedPrompt: string;
  tags: string[];
  maskUrl: string | null;
  status: 'idle' | 'generating' | 'success' | 'error';
  errorMessage: string | null;
  splitPosition: number; // 0 to 100 for Split Slider
}

export interface GooglePicPreset {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  desc: string;
  tag: string;
  isCustom?: boolean;
}

export interface CustomCapsule {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  desc: string;
  tag: string;
  isCustom: true;
  createdAt?: number;
}

export interface CapsuleSettings {
  customCapsules: CustomCapsule[];
  hiddenPresetIds: string[];
}
