import type { ImageMimeType } from "./image-data.ts";
import type { ReferenceImageLimit } from "./validation.ts";

export interface ImageOptionSpec {
  values: readonly string[];
  /** Value the provider uses when the option is omitted, or null when undocumented. */
  default: string | null;
  required: boolean;
}

export interface ReferenceImageSpec extends ReferenceImageLimit {
  acceptedMimeTypes: readonly ImageMimeType[];
  /** Largest inline (data URL) reference image, in bytes. */
  maxInlineBytes: number;
}

/** Describes one image model operation so consumer UIs can offer only valid choices. */
export interface ImageModelInfo {
  id: string;
  name: string;
  provider: string;
  kind: "text-to-image" | "image-to-image" | "text-and-image-to-image";
  promptMaxLength: number | null;
  referenceImages: ReferenceImageSpec;
  aspectRatio: ImageOptionSpec | null;
  resolution: ImageOptionSpec | null;
  background: ImageOptionSpec | null;
  outputFormat: ImageOptionSpec | null;
  /** Whether the `watermark` boolean option is supported. */
  watermark: boolean;
  /** Documented cross-field constraints, as human-readable notes. */
  notes: readonly string[];
}

export function option(values: readonly string[], defaultValue: string | null, required: boolean = false): ImageOptionSpec {
  return { values, default: defaultValue, required };
}
