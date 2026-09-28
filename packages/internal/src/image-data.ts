export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface ParsedDataUrl {
  declaredMimeType: string;
  base64: string;
}

export interface ImageBytes {
  mimeType: ImageMimeType;
  bytes: Uint8Array;
}

const DATA_URL_PATTERN = /^data:([^;,]+)((?:;[^;,]+)*);base64,(.*)$/is;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** Parses a base64 data URL. Returns undefined when the value is not a base64 data URL. */
export function parseDataUrl(value: string): ParsedDataUrl | undefined {
  const match = DATA_URL_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const [, mimeType = "", , payload = ""] = match;
  const base64 = payload.replace(/\s+/g, "");
  if (!base64 || base64.length % 4 === 1 || !BASE64_PATTERN.test(base64)) return undefined;
  return { declaredMimeType: mimeType.toLowerCase(), base64 };
}

export function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/** Identifies the image format from its magic bytes; declared content types are not trusted. */
export function sniffImageMimeType(bytes: Uint8Array): ImageMimeType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return undefined;
}

export function fileExtension(mimeType: ImageMimeType): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
  }
}

export function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KiB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}
