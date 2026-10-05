import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';

const processFinalImage = (dataUrl: string, ratioId: string, resolution: '1K' | '2K' = '1K'): Promise<string> => {
  const is2K = resolution === '2K';
  const RATIOS: Record<string, {width: number, height: number}> = {
    '16:9': is2K ? { width: 2400, height: 1350 } : { width: 1200, height: 675 },
    '4:5': is2K ? { width: 2400, height: 3000 } : { width: 1200, height: 1500 },
    '3:4': is2K ? { width: 2484, height: 3320 } : { width: 1242, height: 1660 },
    '1:1': is2K ? { width: 2400, height: 2400 } : { width: 1200, height: 1200 },
    '9:16': is2K ? { width: 1350, height: 2400 } : { width: 675, height: 1200 },
    '300x250': is2K ? { width: 600, height: 500 } : { width: 300, height: 250 },
    '300x300': is2K ? { width: 600, height: 600 } : { width: 300, height: 300 },
    '336x280': is2K ? { width: 672, height: 560 } : { width: 336, height: 280 },
    '300x600': is2K ? { width: 600, height: 1200 } : { width: 300, height: 600 },
    '320x480': is2K ? { width: 640, height: 960 } : { width: 320, height: 480 },
  };

  const target = RATIOS[ratioId] || (is2K ? { width: 2400, height: 2400 } : { width: 1200, height: 1200 });

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val: string) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    // Safety timeout (5s) in case canvas rendering or image loading takes too long
    const timeoutId = setTimeout(() => {
      console.warn("processFinalImage timed out, resolving with raw dataUrl");
      safeResolve(dataUrl);
    }, 5000);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const srcUrl = (dataUrl.startsWith('http://') || dataUrl.startsWith('https://'))
      ? `/api/proxy-image?url=${encodeURIComponent(dataUrl)}`
      : dataUrl;

    img.onload = () => {
      clearTimeout(timeoutId);
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        safeResolve(dataUrl);
        return;
      }
      
      const imgRatio = img.width / img.height;
      const targetRatio = target.width / target.height;

      // Fill canvas background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, target.width, target.height);

      // 1. 下層 (Bottom Layer): 將原圖延伸填滿整個 Target Canvas，並套用高斯模糊 (Blur) 處理
      let bgSx = 0, bgSy = 0, bgSWidth = img.width, bgSHeight = img.height;
      if (imgRatio > targetRatio) {
        bgSWidth = img.height * targetRatio;
        bgSx = (img.width - bgSWidth) / 2;
      } else {
        bgSHeight = img.width / targetRatio;
        bgSy = (img.height - bgSHeight) / 2;
      }

      ctx.save();
      // 套用 18px 高斯模糊與微暗化，營造流暢背景感
      if ('filter' in ctx) {
        ctx.filter = 'blur(18px) brightness(0.88)';
      }
      ctx.drawImage(img, bgSx, bgSy, bgSWidth, bgSHeight, -10, -10, target.width + 20, target.height + 20);
      ctx.restore();

      // 2. 上層 (Top Layer): 保持原本圖片完整比例，居中疊加在模糊背景上，確保內容（Logo、文字、主題）100% 完整不被切割
      let fgDrawWidth = target.width;
      let fgDrawHeight = target.height;
      let fgOffsetX = 0;
      let fgOffsetY = 0;

      if (imgRatio > targetRatio) {
        // 圖片比目標框寬 -> 寬度填滿，上下加模糊背景
        fgDrawHeight = target.width / imgRatio;
        fgOffsetY = (target.height - fgDrawHeight) / 2;
      } else if (imgRatio < targetRatio) {
        // 圖片比目標框高 -> 高度填滿，左右加模糊背景
        fgDrawWidth = target.height * imgRatio;
        fgOffsetX = (target.width - fgDrawWidth) / 2;
      }

      ctx.drawImage(img, 0, 0, img.width, img.height, fgOffsetX, fgOffsetY, fgDrawWidth, fgDrawHeight);

      try {
        safeResolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch (e) {
        console.warn("toDataURL failed in processFinalImage:", e);
        safeResolve(dataUrl);
      }
    };
    img.onerror = () => {
      clearTimeout(timeoutId);
      console.warn("processFinalImage img.onerror, resolving with raw dataUrl");
      safeResolve(dataUrl);
    };
    img.src = srcUrl;
  });
};

/**
 * Edits an image with the selected model. The server keeps the original aspect ratio and pixel
 * size, so no client-side resizing is needed.
 */
export const editOgImage = async (
  baseImage: string,
  editPrompt: string,
  modelId: string,
  language: 'tc' | 'sc' = 'tc',
  signal?: AbortSignal
) => {
  const data = await postImageRequest(
    "/api/gemini/edit",
    {
      baseImage,
      editPrompt,
      modelId,
      language,
    },
    signal
  );
  return data.imageUrl;
};

export const generateOgImage = async (
  templateImage: string,
  sourceImages: string[],
  brandLogo: string | null,
  globalPrompt: string,
  ratioPrompt: string,
  ratio: string,
  modelId: string,
  eraseTemplateSubject: boolean = true,
  lockBrandLogo: boolean = true,
  // Only for models that accept it (temperatureFor); undefined otherwise.
  temperature: number | undefined = undefined,
  aiMatting: boolean = false,
  forbidPretrainedKnowledge: boolean = true,
  imageResolution: '1K' | '2K' = '1K',
  language: 'tc' | 'sc' = 'tc',
  signal?: AbortSignal
) => {
  const data = await postImageRequest(
    "/api/gemini/generate",
    {
      templateImage,
      sourceImages,
      brandLogo,
      globalPrompt,
      ratioPrompt,
      ratio,
      modelId,
      eraseTemplateSubject,
      lockBrandLogo,
      temperature,
      aiMatting,
      forbidPretrainedKnowledge,
      imageResolution,
      language,
    },
    signal
  );
  return await processFinalImage(data.imageUrl, ratio, imageResolution);
};
