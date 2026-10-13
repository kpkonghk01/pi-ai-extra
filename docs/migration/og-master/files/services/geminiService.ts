import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
import { DEFAULT_IMAGE_MODEL_ID } from '../shared/imageModels';
import { AspectRatio, ImageQuality, TitleConfig, ImageAsset, TitleConfigItem, ImageModelType } from "../types";

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

// Helper to centre-crop an image to strict dimensions (scale to cover, no stretching) and convert to JPEG
export const resizeAndConvertToJpeg = (dataUrl: string, targetWidth: number, targetHeight: number): Promise<string> => {
  return new Promise((resolve, reject) => {
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

      // Scale to cover the target and centre-crop: a model's nearest ratio is never stretched
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      ctx.drawImage(img, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);

      // Force JPEG quality 0.9
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('無法解碼生成的圖片 (Failed to decode the generated image)。'));
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
         const mimeType = url.match(/:(.*?);/)?.[1] || 'image/jpeg';
         const base64Data = url.split(',')[1] || '';
         return { data: base64Data, mimeType };
    }
    const response = await fetch(url);
    const blob = await response.blob();
    return fileToBase64(new File([blob], "temp", { type: blob.type }));
};

const ensureDataUrl = async (url: string): Promise<string> => {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("Failed to convert image URL to data URL on client:", e);
    return url;
  }
};

const mapRatioToSupported = (ratio: AspectRatio): string => {
  switch (ratio) {
    case '4:5': return '3:4';
    case '300x250': return '4:3';
    case '300x300': return '1:1';
    default: return ratio;
  }
};

const getTargetDimensions = (ratio: AspectRatio): { width: number, height: number } => {
  switch (ratio) {
    case '16:9': return { width: 1200, height: 675 };
    case '4:5': return { width: 1600, height: 2000 };
    case '9:16': return { width: 1080, height: 1920 };
    case '1:1': return { width: 1080, height: 1080 };
    case '300x250': return { width: 300, height: 250 };
    case '300x300': return { width: 300, height: 300 };
    default: return { width: 1024, height: 1024 };
  }
};

// We ignore the quality param effectively because we are doing post-process resizing to high res
const mapQualityToSize = (quality: ImageQuality): string => {
  // Request '2K' from Gemini to ensure we have enough pixels to downscale nicely to 1600/1800
  return '2K'; 
};

export const generateCollage = async (
  templateAssets: ImageAsset[],
  sourceAssets: ImageAsset[],
  prompt: string,
  ratio: AspectRatio,
  quality: ImageQuality,
  strictFidelity: boolean = false,
  preserveBackground: boolean = false,
  removeBackground: boolean = false,
  copyLogo: boolean = false,
  prohibitLogo: boolean = true,
  eraseText: boolean = true,
  titleConfig?: TitleConfig,
  selectedModel: ImageModelType = DEFAULT_IMAGE_MODEL_ID,
  temperature: number = 0.7,
  prohibitPretrainedData: boolean = true,
  signal?: AbortSignal
): Promise<string> => {
  const payload = {
    templateAssets,
    sourceAssets,
    prompt,
    ratio,
    quality,
    strictFidelity,
    preserveBackground,
    removeBackground,
    copyLogo,
    prohibitLogo,
    eraseText,
    titleConfig,
    selectedModel,
    temperature,
    prohibitPretrainedData
  };

  // One attempt with the selected model. The server streams NDJSON; failures throw an
  // ImageRequestError with the provider, model, error code and task id.
  const { imageUrl } = await postImageRequest('/api/generate-collage', payload, signal);

  // Post-Processing: centre-crop to the requested dimensions and convert to JPEG on the client side
  const dimensions = getTargetDimensions(ratio);
  return await resizeAndConvertToJpeg(imageUrl, dimensions.width, dimensions.height);
};

/** Natural width and height of an image URL. */
const imageSize = (url: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('無法讀取原圖尺寸 (Failed to read the image size)。'));
    img.src = url;
  });
};

export const editImage = async (
  imageUrl: string,
  maskBase64: string | null,
  prompt: string,
  isMultiMask: boolean = false,
  selectedModel: ImageModelType = DEFAULT_IMAGE_MODEL_ID
): Promise<string> => {
  const safeImageUrl = await ensureDataUrl(imageUrl);
  const safeMaskBase64 = maskBase64 ? await ensureDataUrl(maskBase64) : null;
  // The edited image keeps the original's aspect and pixel size.
  const { width, height } = await imageSize(safeImageUrl);

  const payload = {
    imageUrl: safeImageUrl,
    maskBase64: safeMaskBase64,
    prompt,
    isMultiMask,
    selectedModel,
    sourceAspect: `${width}:${height}`
  };

  // One attempt with the selected model (NDJSON stream, see generateCollage).
  const { imageUrl: editedUrl } = await postImageRequest('/api/edit-image', payload);

  // A model that cannot keep the input aspect returns its nearest ratio: centre-crop it back to
  // the original size, as JPEG to match the system standard.
  return resizeAndConvertToJpeg(editedUrl, width, height);
};