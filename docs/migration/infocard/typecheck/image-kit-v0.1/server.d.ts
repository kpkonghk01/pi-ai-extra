export interface ImageModelOption {
  id: string;
  label: string;
  description: string;
  provider: 'google' | 'kie' | 'toapis';
  model: string;
  textOnlyModel?: string;
  maskEditing: 'supported' | 'reference-only';
  price: unknown;
}
export type ReferenceConverter = (dataUrl: string, target: { acceptedMimeTypes: readonly string[]; maxInlineBytes: number }) => Promise<string>;
export interface ImagePart { text?: string; inlineData?: { data: string; mimeType: string } }
export interface ImageClient { listModels(): unknown[] }
export function createImageClient(config: unknown): ImageClient;
export function handleImageRequest(res: unknown, client: ImageClient, request: unknown, finish: (image: { dataUrl: string }) => Promise<Record<string, unknown>>): Promise<void>;
