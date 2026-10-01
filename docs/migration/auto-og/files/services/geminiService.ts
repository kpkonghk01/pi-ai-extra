import { AspectRatio, TitleConfig, ImageAsset, TitleConfigItem } from "../types";
import { outputSpec } from "../shared/imageOutput";
import { postImageRequest } from "./imageApi";

// Helper to convert File to Base64 with resizing to prevent 413 errors
export const fileToBase64 = (file: File): Promise<ImageAsset> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) {
          reject(new Error("Failed to read file"));
          return;
      }

      const img = new Image();
      img.onload = () => {
        const MAX_DIMENSION = 1280;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
             const rawMime = src.match(/:(.*?);/)?.[1] || file.type || 'image/jpeg';
             const rawData = src.split(',')[1];
             resolve({
                 data: rawData,
                 mimeType: rawMime
             });
             return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        let outputMime = 'image/jpeg';
        if (file.type === 'image/png' || src.startsWith('data:image/png')) {
            outputMime = 'image/png';
        }

        const dataUrl = canvas.toDataURL(outputMime, 0.85);
        const realMime = dataUrl.match(/:(.*?);/)?.[1] || outputMime;
        const realData = dataUrl.split(',')[1];

        resolve({
            data: realData,
            mimeType: realMime
        });
      };
      img.onerror = (e) => reject(new Error("Failed to load image for resizing"));
      img.src = src;
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
};

// Helper to resize image to strict dimensions and convert to JPEG
export const resizeAndConvertToJpeg = (dataUrl: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl); // Fallback
        return;
      }
      
      // Draw background white (for transparency handling if any)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // Centre-crop to the target ratio, then scale (never stretch: models may return a nearby ratio)
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const cropW = targetWidth / scale;
      const cropH = targetHeight / scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.width - cropW) / 2, (img.height - cropH) / 2, cropW, cropH, 0, 0, targetWidth, targetHeight);
      
      // Force JPEG quality 0.9
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

// Exclusive lossless rendering algorithm for 300x250 advertising ratio
export const cropAndResizeFor300x250 = (dataUrl: string, targetWidth: number = 300, targetHeight: number = 250): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      const srcW = img.width;
      const srcH = img.height;
      const targetAspect = targetWidth / targetHeight; // 300 / 250 = 1.2
      const srcAspect = srcW / srcH; // Gemini 4:3 = 1.333

      let cropX = 0;
      let cropY = 0;
      let cropW = srcW;
      let cropH = srcH;

      if (srcAspect >= targetAspect) {
        // Source is wider than 300:250 (e.g., 4:3)
        // Keep 100% of height so top/bottom text & logo are 100% preserved
        cropH = srcH;
        cropW = srcH * targetAspect;
        cropX = (srcW - cropW) / 2;
        cropY = 0;
      } else {
        // Source is taller than 300:250
        cropW = srcW;
        cropH = srcW / targetAspect;
        cropX = 0;
        cropY = (srcH - cropH) / 2;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, targetWidth, targetHeight);

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

// Helper to compress a data URL image to be under a certain byte size
export const compressToLimit = async (dataUrl: string, maxBytes: number = 2 * 1024 * 1024): Promise<string> => {
  // Check current size roughly (Base64 is ~4/3 of binary size)
  const stringLength = dataUrl.length - (dataUrl.indexOf(',') + 1);
  const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.5624896334383812; // Adjusted factor for precision
  
  if (sizeInBytes <= maxBytes) return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      
      // Ensure white background for JPEG conversion transparency handling
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      let quality = 0.9;
      let result = dataUrl;
      
      // Iteratively reduce quality to hit the target size
      while (quality > 0.1) {
        const compressed = canvas.toDataURL('image/jpeg', quality);
        const compressedLength = compressed.length - (compressed.indexOf(',') + 1);
        const compressedSize = compressedLength * 0.75;
        
        if (compressedSize <= maxBytes) {
          result = compressed;
          break;
        }
        quality -= 0.1;
      }
      resolve(result);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

const urlToAsset = async (url: string): Promise<ImageAsset> => {
    if (url.startsWith('data:')) {
         const res = await fetch(url);
         const blob = await res.blob();
         return fileToBase64(new File([blob], "temp", { type: blob.type }));
    }
    const response = await fetch(url);
    const blob = await response.blob();
    return fileToBase64(new File([blob], "temp", { type: blob.type }));
};

// Helper to fetch article full text from URL
export const fetchArticleText = async (url: string): Promise<{ title: string; content: string }> => {
  const response = await fetch('/api/fetch-article', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '抓取文章失敗');
  }

  return await response.json();
};

export interface ExtractedImageItem {
  name: string;
  dataUrl: string;
  isOg: boolean;
}

// Helper to extract page images (OG + content images)
export const extractPageImages = async (url: string): Promise<ExtractedImageItem[]> => {
  const response = await fetch('/api/extract-page-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '抓取網頁圖片失敗');
  }

  const { images } = await response.json();
  return images;
};

// Convert Base64 Data URL to a browser File object
export const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
};

export interface ViralTitleGroup {
  groupIndex: number;
  main: string;
  sub: string;
  small: string;
}

// Helper to generate 5 viral social media title groups
export const generateViralTitles = async (
  articleText: string,
  textModel: 'gemini-3.8-flash' | 'gemini-3.5-flash-lite' | 'gemini-3.7-flash',
  limits: { mainMax: number; subMax: number; smallMax: number }
): Promise<ViralTitleGroup[]> => {
  const response = await fetch('/api/generate-viral-titles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleText, textModel, limits })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '生成爆款標題失敗');
  }

  const { titles } = await response.json();
  return titles;
};

export interface CollageRequest {
  templateAssets: ImageAsset[];
  sourceAssets: ImageAsset[];
  prompt: string;
  ratio: AspectRatio;
  strictFidelity?: boolean;
  preserveBackground?: boolean;
  removeBackground?: boolean;
  copyLogo?: boolean;
  prohibitLogo?: boolean;
  prohibitPretrainedLogo?: boolean;
  eraseText?: boolean;
  titleConfig?: TitleConfig;
  /** App image model id from GET /api/image-models. */
  selectedModel: string;
  /** Only for models that accept temperature; the server rejects it for the others. */
  temperature?: number;
}

/** Generates one collage with the selected model (one attempt, no fallback) and post-processes it to the ratio's size. */
export const generateCollage = async (request: CollageRequest): Promise<string> => {
  const rawImageBase64 = await postImageRequest('/api/generate-collage', {
    templateAssets: request.templateAssets,
    sourceAssets: request.sourceAssets,
    prompt: request.prompt,
    ratio: request.ratio,
    strictFidelity: request.strictFidelity ?? false,
    preserveBackground: request.preserveBackground ?? false,
    removeBackground: request.removeBackground ?? false,
    copyLogo: request.copyLogo ?? false,
    prohibitLogo: request.prohibitLogo ?? true,
    prohibitPretrainedLogo: request.prohibitPretrainedLogo ?? true,
    eraseText: request.eraseText ?? true,
    titleConfig: request.titleConfig,
    selectedModel: request.selectedModel,
    temperature: request.temperature,
  });

  // Post-Processing: Resize to strictly requested dimensions and convert to JPEG on the client side
  const dimensions = outputSpec(request.ratio);
  if (request.ratio === '300x250' || request.ratio === '320x250') {
    return await cropAndResizeFor300x250(rawImageBase64, dimensions.width, dimensions.height);
  }
  return await resizeAndConvertToJpeg(rawImageBase64, dimensions.width, dimensions.height);
};

export interface EditRequest {
  imageUrl: string;
  maskBase64: string | null;
  prompt: string;
  isMultiMask?: boolean;
  /** App image model id from GET /api/image-models. */
  selectedModel: string;
  extraImageBase64?: string | null;
  /** "width:height" of the image being edited, so models without "keep input aspect" use the nearest ratio. */
  sourceAspect?: string;
  /** Only for models that accept temperature; omitted means the server's edit default (0.7) on those models. */
  temperature?: number;
}

/** Edits one image with the selected model (one attempt, no fallback). */
export const editImage = async (request: EditRequest): Promise<string> => {
  const rawImageBase64 = await postImageRequest('/api/edit-image', {
    imageUrl: request.imageUrl,
    maskBase64: request.maskBase64,
    prompt: request.prompt,
    isMultiMask: request.isMultiMask ?? false,
    selectedModel: request.selectedModel,
    extraImageBase64: request.extraImageBase64 ?? null,
    sourceAspect: request.sourceAspect,
    temperature: request.temperature,
  });

  // Convert edited image to JPEG as well to match system standard
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resizeAndConvertToJpeg(rawImageBase64, img.width, img.height).then(resolve);
    };
    img.src = rawImageBase64;
  });
};