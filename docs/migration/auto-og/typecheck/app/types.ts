export interface UploadedFile {
  id: string;
  file: File;
  previewUrl: string;
}

export interface ImageAsset {
  data: string;
  mimeType: string;
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '300x250' | '320x250' | '300x300';

export type ImageQuality = '1K' | '2K';

export interface GeneratedImage {
  id: string;
  url: string; // Base64 data URL
  ratio: AspectRatio;
  timestamp: number;
}

export interface GenerationSettings {
  ratios: AspectRatio[];
  quality: ImageQuality;
  count: 1 | 2 | 3;
  prompt: string;
}

export interface EditState {
  isOpen: boolean;
  image: GeneratedImage | null;
  mode: 'view' | 'edit-prompt' | 'masking' | 'crop' | 'text';
}

export interface TitleConfigItem {
  text: string;
  color: string;
  size: number;
  isAutoColor: boolean;
}

export interface TitleConfig {
  main: TitleConfigItem;
  sub: TitleConfigItem;
  small: TitleConfigItem;
  tiny: TitleConfigItem;
}