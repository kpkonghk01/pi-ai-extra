import type { ImagesProvider } from "@earendil-works/pi-ai";
import { createHelperImagesProvider } from "@hk01/pi-ai-extra-internal/pi-ai";
import { GOOGLE_BASE_URL, GOOGLE_IMAGES_API, GOOGLE_PROVIDER_ID, GOOGLE_PROVIDER_NAME } from "../constants.ts";
import { generateGoogleImage, type GoogleImageRequest, type GoogleImageSettings } from "../generate.ts";
import { GOOGLE_IMAGE_MODELS } from "../models.ts";

export interface GoogleImagesProviderOptions {
  /** Gemini API key from server-side secret configuration. */
  apiKey: string;
  settings?: GoogleImageSettings | undefined;
}

/**
 * pi-ai `ImagesProvider` for Gemini image models, backed by `generateGoogleImage`.
 * Gemini chat keeps using pi-ai's built-in `google` provider. Model options go in
 * `ImagesOptions.metadata` (for example `{ aspectRatio: "16:9", resolution: "2K" }`).
 */
export function createGoogleImagesProvider(options: GoogleImagesProviderOptions): ImagesProvider {
  return createHelperImagesProvider({
    id: GOOGLE_PROVIDER_ID,
    name: GOOGLE_PROVIDER_NAME,
    api: GOOGLE_IMAGES_API,
    baseUrl: options.settings?.baseUrl ?? GOOGLE_BASE_URL,
    apiKey: options.apiKey,
    models: GOOGLE_IMAGE_MODELS,
    settings: options.settings,
    generate: (request) => generateGoogleImage(request as unknown as GoogleImageRequest),
  });
}
