import type { ImageMimeType } from "./image-data.ts";
import type { ReferenceImageLimit } from "./validation.ts";

export interface ImageOptionSpec {
  values: readonly string[];
  /** Value the provider uses when the option is omitted, or null when undocumented. */
  default: string | null;
  required: boolean;
}

/** An inclusive numeric range accepted by an option. */
export interface NumericRangeSpec {
  min: number;
  max: number;
}

export interface ReferenceImageSpec extends ReferenceImageLimit {
  acceptedMimeTypes: readonly ImageMimeType[];
  /** Largest inline (data URL) reference image, in bytes. */
  maxInlineBytes: number;
}

export type ImageOperationRole = "unified" | "text-to-image" | "image-to-image";

/** Describes one image model operation so consumer UIs can offer only valid choices. */
export interface ImageModelInfo {
  id: string;
  name: string;
  provider: string;
  /** Stable provider-owned family ID, shared by paired text/edit operations. */
  familyId: string;
  /** User-facing family label. Consumers select this rather than an operation. */
  familyName: string;
  /** Operation chosen by image-kit from whether a request has reference images. */
  operationRole: ImageOperationRole;
  kind: "text-to-image" | "image-to-image" | "text-and-image-to-image";
  promptMaxLength: number | null;
  referenceImages: ReferenceImageSpec;
  aspectRatio: ImageOptionSpec | null;
  resolution: ImageOptionSpec | null;
  background: ImageOptionSpec | null;
  outputFormat: ImageOptionSpec | null;
  /** Whether the `watermark` boolean option is supported. */
  watermark: boolean;
  // The next two are optional rather than `| null` (the convention above) because catalogues
  // released before they existed omit them, and an absent field must read as unsupported.
  /** Accepted sampling `temperature` range. Absent: the model does not accept temperature. */
  temperature?: NumericRangeSpec;
  /** Present when a `systemInstruction` is accepted. Absent: it is not. */
  systemInstruction?: true;
  /** Documented cross-field constraints, as human-readable notes. */
  notes: readonly string[];
}

export function option(values: readonly string[], defaultValue: string | null, required: boolean = false): ImageOptionSpec {
  return { values, default: defaultValue, required };
}
