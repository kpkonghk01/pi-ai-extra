# og-master migration, Part 3 of 4: image requests, cancelling and errors

Continue the same task. Parts 1 and 2 are already applied, and their rules and edit format still apply.

This part makes the browser read the server's NDJSON stream with the image kit's `postImageRequest()`. It also:

- sends model and provider errors to the image kit's error panel;
- makes 取消 really cancel the request, without reloading the page;
- centre-crops results instead of stretching them;
- keeps edited images at their original size.

## Step 1: `services/geminiService.ts`

Replace the unused `@google/genai` import. The browser never calls Gemini.

**Find** in `services/geminiService.ts`:

```ts
import { GoogleGenAI } from "@google/genai";
```

**Replace with:**

```ts
import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
import { DEFAULT_IMAGE_MODEL_ID } from '../shared/imageModels';
```

Make the post-processing centre-crop instead of stretching. Before, a 4:5 collage was generated as 3:4 and stretched by about 7%, and 300x250 was squeezed by about 10%. A decoding failure now reports an error instead of returning the undecoded image.

**Replace from** `services/geminiService.ts`:

```ts
// Helper to resize image to strict dimensions and convert to JPEG
```

**through:**

```ts
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};
```

**Replace with:**

```ts
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
```

Replace `generateCollage` and `editImage` (the rest of the file):

- Both read the NDJSON stream with `postImageRequest()`.
- `generateCollage` takes an optional `signal` as its last parameter, so 取消 can abort it.
- `editImage` sends the original image's `width:height`, then centre-crops the result back to the original pixel size. Before, an edited 1600×2000 image came back at the model's own size. This also fixes the editor waiting forever when the returned image could not be decoded.

**Replace from** `services/geminiService.ts`:

```ts
export const generateCollage = async (
```

**through:**

```ts
    img.src = rawImageBase64;
  });
};
```

**Replace with:**

```ts
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
```

## Step 2: imports in `App.tsx`

**Find** in `App.tsx`:

```ts
import React, { useState, useEffect, ReactNode, ErrorInfo, useMemo } from 'react';
```

**Replace with:**

```ts
import React, { useState, useEffect, useRef, ReactNode, ErrorInfo, useMemo } from 'react';
```

**Find** in `App.tsx`:

```ts
import { ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
```

**Replace with:**

```ts
import { ErrorPanel, ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
import { ImageRequestError, isAbort, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
```

## Step 3: the key check

Remove the fallback that read the build-time key in the browser. Part 1 removed the `define`, so `process.env.API_KEY` no longer exists there.

**Find** in `App.tsx`:

```ts
            // Fallback to define env check
            try {
              setHasApiKey(!!process.env.API_KEY);
            } catch (e) {
              setHasApiKey(false);
            }
```

**Replace with:**

```ts
            // The server could not be asked; the browser never holds the key itself.
            setHasApiKey(false);
```

## Step 4: error handling

Every failure goes to the error panel, which has 「複製錯誤資訊」. The 「Authentication Required」 key screen still appears only for a Google 403 / PERMISSION_DENIED, as before. KIE and ToAPIs errors stay in the error panel.

**Replace from** `App.tsx`:

```ts
  const handleApiError = (error: any) => {
```

**through:**

```ts
       showToast(`產生失敗: ${msg}`, "error");
    }
  };
```

**Replace with:**

```ts
  const handleApiError = (error: any, context: Record<string, string | number | undefined> = {}) => {
    console.error("API Error:", error);
    // The ErrorPanel shows the provider, model, error code, HTTP status and task id, with 複製錯誤資訊.
    reportError(error, '拼貼生成', { model: selectedModel, ...context });
    const msg = error?.message || '';
    const details = error instanceof ImageRequestError ? error.details : {};
    // Same trigger as before the migration (403 / PERMISSION_DENIED), now limited to Google errors.
    const keyPermissionProblem = details.status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('Requested entity was not found');
    if (keyPermissionProblem && (details.provider === 'google' || !details.provider)) {
       showToast("授權失敗。請選擇具有啟用計費功能 (Billing Enabled) 的 Google Cloud Project 專案 API 密鑰。", "error");
       setHasApiKey(false);
    }
  };
```

## Step 5: 取消 aborts the request

**Find** in `App.tsx`:

```ts
  const [isGenerating, setIsGenerating] = useState(false);
```

**Replace with:**

```ts
  const [isGenerating, setIsGenerating] = useState(false);
  /** Aborts the collage in progress (取消). */
  const generateAbortRef = useRef<AbortController | null>(null);
```

Replace the whole `startCollage` function. Everything in it stays the same, except:

- an `AbortController` per run;
- the `signal` passed to `generateCollage`;
- a cancel is not reported as an error;
- a failure is reported with its ratio.

**Replace from** `App.tsx`:

```ts
  const startCollage = async () => {
```

**through:**

```ts
      setGeneratingStatus('');
    }
  };
```

**Replace with:**

```ts
  const startCollage = async () => {
    const apiKey = getEnvApiKey();
    if (!apiKey) {
      setHasApiKey(false);
      return;
    }
    if (selectedTemplateIds.length === 0) {
        showToast("請上傳並選擇至少一張「風格範本」圖片才能開始拼貼。", "warning");
        return;
    }
    if (sources.length === 0) {
        showToast("請上傳至少一張「主體」圖片才能開始拼貼。", "warning");
        return;
    }
    if (selectedRatios.length === 0) {
        showToast("請選擇至少一種圖片比例比例。", "warning");
        return;
    }
    setIsGenerating(true);
    setGeneratingStatus('Preparing assets...');
    // One controller per run: 取消 aborts the request in flight and stops the remaining tasks.
    const abort = new AbortController();
    generateAbortRef.current = abort;
    try {
      const selectedTemplates = templates.filter(t => selectedTemplateIds.includes(t.id));
      const templateB64s = await Promise.all(selectedTemplates.map(t => fileToBase64(t.file)));
      const sourcesB64 = await Promise.all(sources.map(s => fileToBase64(s.file)));

      // Construct effective prompt with manga options
      let effectivePrompt = prompt;
      if (isMangaActive) {
        effectivePrompt += `\n\n【日本漫畫風格 (Japanese Manga Art Style)】：將圖片中所有的物件、背景、人物、產品、建築等等，均轉換並繪製為品質高雅的日本漫畫風格 (Japanese Manga / Anime Art Style)。除非用戶特別指定某物件或人物必須維持真實寫實風格。`;
      } else if (isCustomMangaActive && customMangaPrompt.trim()) {
        effectivePrompt += `\n\n【訂製漫畫化風格要求 (Custom Manga Style Requirement)】：${customMangaPrompt.trim()}`;
      }
      
      // Calculate tokens per single request for usage tracking
      const totalInputImages = selectedTemplates.length + sources.length;
      const estimatedInputTokensPerReq = UsageService.calculateEstimatedTokens(totalInputImages, effectivePrompt.length);

      const tasks = [];
      for (const ratio of selectedRatios) {
        for (let i = 0; i < selectedCount; i++) {
          tasks.push({ ratio, index: i });
        }
      }
      setGeneratingStatus(`Generating ${tasks.length} images...`);
      for (let i = 0; i < tasks.length; i++) {
        if (abort.signal.aborted) break;
        const task = tasks[i];
        setGeneratingStatus(`Generating image ${i + 1} of ${tasks.length} (${task.ratio})...`);
        try {
            let base64Image = await generateCollage(
                templateB64s,
                sourcesB64,
                effectivePrompt,
                task.ratio,
                selectedQuality,
                strictFidelity,
                preserveBackground,
                removeBackground,
                copyLogo,
                prohibitLogo,
                eraseText,
                titles,
                selectedModel,
                temperature,
                prohibitPretrainedData,
                abort.signal
            );


            // Apply size limit if active
            if (limitSize2MB) {
              base64Image = await compressToLimit(base64Image, 2 * 1024 * 1024);
            }

            // Track usage on success: the estimated cost at the resolution actually requested (null = 未計價)
            const costUsd = estimateCostUsd(currentImageModel, { inputImages: totalInputImages, promptChars: effectivePrompt.length, ratios: [task.ratio] });
            UsageService.trackTransaction(estimatedInputTokensPerReq, 1, costUsd);
            setUsageUpdateTrigger(prev => prev + 1);

            const newImage: GeneratedImage = {
                id: Math.random().toString(36).substr(2, 9),
                url: base64Image,
                ratio: task.ratio,
                timestamp: Date.now()
            };
            setGeneratedImages(prev => [newImage, ...prev]);
        } catch (err) {
            // A cancel is not an error; a failure is reported once and stops the remaining tasks.
            if (!isAbort(err, abort.signal)) {
              handleApiError(err, { 比例: task.ratio });
            }
            break;
        }
      }
    } catch (error) {
      if (!isAbort(error, abort.signal)) {
        handleApiError(error);
      }
    } finally {
      if (generateAbortRef.current === abort) generateAbortRef.current = null;
      setIsGenerating(false);
      setGeneratingStatus('');
    }
  };
```

**Find** in `App.tsx`:

```ts
                        <button onClick={() => { window.location.reload(); }} className="px-4 bg-gray-100 text-gray-700 border border-gray-300 rounded-xl font-bold hover:bg-gray-200 transition-colors cursor-pointer text-xs">
```

**Replace with:**

```ts
                        <button onClick={() => generateAbortRef.current?.abort()} className="px-4 bg-gray-100 text-gray-700 border border-gray-300 rounded-xl font-bold hover:bg-gray-200 transition-colors cursor-pointer text-xs">
```

取消 no longer reloads the page. The templates, sources, titles and settings stay. A task already submitted to a provider is still billed; the server only stops waiting for it.

## Step 6: mount the error panel

Mount it once, outside `AppContent`, so that it also shows on the login and key screens.

**Find** in `App.tsx`:

```ts
const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
};
```

**Replace with:**

```ts
const App: React.FC = () => {
  return (
    <>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
      {/* image-kit error panel: mounted once, outside screens that can unmount (also on the login and key screens) */}
      <ErrorPanel />
    </>
  );
};
```

## Step 7: editor errors

Errors from an image request also go to the error panel. The editor's red banner stays.

**Find** in `components/ImageEditor.tsx`:

```ts
import { findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
```

**Replace with:**

```ts
import { findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
import { ImageRequestError, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
```

**Find** in `components/ImageEditor.tsx`:

```ts
    } catch (e: any) {
      console.error(e);
      setEditorError(`AI Logo 替換失敗: ${e.message || '請稍後再試'}`);
```

**Replace with:**

```ts
    } catch (e: any) {
      console.error(e);
      if (e instanceof ImageRequestError) reportError(e, 'AI Logo 擦除', { model: selectedModel });
      setEditorError(`AI Logo 替換失敗: ${e.message || '請稍後再試'}`);
```

**Find** in `components/ImageEditor.tsx`:

```ts
        console.error(e);
        const msg = e.message || 'Unknown error';
        setEditorError(`Failed to edit image: ${msg}`);
```

**Replace with:**

```ts
        console.error(e);
        const msg = e.message || 'Unknown error';
        if (e instanceof ImageRequestError) reportError(e, '圖片編輯', { model: selectedModel });
        setEditorError(`Failed to edit image: ${msg}`);
```

## Step 8: check Part 3

1. `npm run lint` and `npm run build` pass. `npm start` starts the server from `dist/server.mjs`.
2. Search the app. None of these remain: `rawImageBase64`, `window.location.reload(); }`, `process.env.API_KEY`, `from "@google/genai"` in `services/` or `components/`.
3. Generate a collage with Nano Banana 2.1, then edit the result with a brush mask. Both succeed, and the edited image keeps its size.
4. Reply with every file you changed, and every step where the code did not match exactly and how you applied it.

Do not start Part 4 until the user sends it.
