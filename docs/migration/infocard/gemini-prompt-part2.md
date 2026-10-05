# InfoCard migration, Part 2 of 3: client plumbing, OG tab and editor

Part 1 moved the server to the image kit. This part moves the shared browser code, the OG 拼貼 tab (`App.tsx`), the image editor (`DeepEditor.tsx`) and the cost history to it. The rules from Part 1 still apply.

## Step 7: `vite.config.ts`

Remove the `define` that copied `GEMINI_API_KEY` into the browser bundle (and the now unused `loadEnv`):

```diff
diff --git a/vite.config.ts b/vite.config.ts
index bfd19a3..54bb530 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -1,15 +1,11 @@
 import tailwindcss from '@tailwindcss/vite';
 import react from '@vitejs/plugin-react';
 import path from 'path';
-import {defineConfig, loadEnv} from 'vite';
+import {defineConfig} from 'vite';
 
-export default defineConfig(({mode}) => {
-  const env = loadEnv(mode, '.', '');
+export default defineConfig(() => {
   return {
     plugins: [react(), tailwindcss()],
-    define: {
-      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
-    },
     resolve: {
       alias: {
         '@': path.resolve(__dirname, './src'),
```

## Step 8: `src/main.tsx`

Mount the error panel once, outside `App`, so it also shows on the login screen:

```diff
diff --git a/src/main.tsx b/src/main.tsx
index fc82314..7e2f977 100644
--- a/src/main.tsx
+++ b/src/main.tsx
@@ -3,11 +3,14 @@ import {createRoot} from 'react-dom/client';
 import App from './App.tsx';
 import './index.css';
 import { LanguageProvider } from './contexts/LanguageContext';
+import { ErrorPanel } from '@hk01/pi-ai-extra-image-kit/react';
 
 createRoot(document.getElementById('root')!).render(
   <StrictMode>
     <LanguageProvider>
       <App />
+      {/* Image errors with provider/model, outside App so the login screen shows them too */}
+      <ErrorPanel />
     </LanguageProvider>
   </StrictMode>,
 );
```

## Step 9: model id types

Image model ids now come from the server (`GET /api/image-models`), so the hard-coded unions become `string`. A saved id of a removed model (`openrouter-gpt-image-2`, `doubao-seedream-5-0`) is reset to `nano-banana-2` by the selector.

```diff
diff --git a/src/types/infocard.ts b/src/types/infocard.ts
index cb7b4cc..eb16cf4 100644
--- a/src/types/infocard.ts
+++ b/src/types/infocard.ts
@@ -1,7 +1,8 @@
 export type InfoCardMode = 'manual' | 'semi-auto' | 'full-auto';
 export type InfoCardRatio = '4:5' | '9:16' | '1:1' | '3:4';
 export type InfoCardResolution = '1K' | '2K';
-export type InfoCardModel = 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2' | 'doubao-seedream-5-0';
+/** Image model id from GET /api/image-models (server/imageModels.ts). */
+export type InfoCardModel = string;
 export type InfoCardTextModel = 'gemini-3.8-flash' | 'gemini-3.5-flash-lite';
 
 export interface TitleSet {
diff --git a/src/types/possession.ts b/src/types/possession.ts
index bc3328d..b1421d2 100644
--- a/src/types/possession.ts
+++ b/src/types/possession.ts
@@ -1,4 +1,5 @@
-export type PossessionImageModel = 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2';
+/** Image model id from GET /api/image-models (server/imageModels.ts). */
+export type PossessionImageModel = string;
 export type PossessionTextModel = 'gemini-3.8-flash' | 'gemini-3.1-flash-lite';
 export type PossessionRatio = '16:9' | '4:5' | '3:4' | '1:1' | '9:16';
 export type PossessionResolution = '1K';
diff --git a/src/types/batch.ts b/src/types/batch.ts
index 72b24ca..ed620c1 100644
--- a/src/types/batch.ts
+++ b/src/types/batch.ts
@@ -1,4 +1,5 @@
-export type BatchModelId = 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2' | 'openrouter-gpt-image-2' | 'doubao-seedream-5-0';
+/** Image model id from GET /api/image-models (server/imageModels.ts). */
+export type BatchModelId = string;
 
 export type BatchAspectRatio = '4:5' | '3:4' | 'original' | '1:1' | '16:9' | '9:16';
 
diff --git a/src/store.ts b/src/store.ts
index 9d0b48b..d061530 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -5,6 +5,7 @@ export interface GeneratedImage {
   url: string;
   ratio: string;
   timestamp: number;
+  /** Estimated HK$, or UNPRICED_COST_HKD (-1) when the model has no verified price. */
   costHKD: number;
   model: string;
   resolution?: '1K' | '2K';
@@ -32,7 +33,8 @@ export interface AppState {
   globalPrompt: string;
   selectedRatios: string[];
   ratioPrompts: Record<string, string>;
-  selectedModel: 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2' | 'doubao-seedream-5-0' | string;
+  /** Image model id from GET /api/image-models; an unknown saved id is reset by the selector. */
+  selectedModel: string;
   history: GeneratedImage[];
 }
```

## Step 10: API helpers

The image calls now read the server's NDJSON stream through `postImageRequest` from `@hk01/pi-ai-extra-image-kit/browser`.

```diff
diff --git a/src/lib/gemini.ts b/src/lib/gemini.ts
index 9821c65..8b36487 100644
--- a/src/lib/gemini.ts
+++ b/src/lib/gemini.ts
@@ -1,3 +1,5 @@
+import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
+
 const processFinalImage = (dataUrl: string, ratioId: string, resolution: '1K' | '2K' = '1K'): Promise<string> => {
   const is2K = resolution === '2K';
   const RATIOS: Record<string, {width: number, height: number}> = {
@@ -107,38 +109,28 @@ const processFinalImage = (dataUrl: string, ratioId: string, resolution: '1K' |
   });
 };
 
+/**
+ * Edits an image with the selected model. The server keeps the original aspect ratio and pixel
+ * size, so no client-side resizing is needed.
+ */
 export const editOgImage = async (
   baseImage: string,
   editPrompt: string,
-  ratio: string,
   modelId: string,
-  language: 'tc' | 'sc' = 'tc'
+  language: 'tc' | 'sc' = 'tc',
+  signal?: AbortSignal
 ) => {
-  const response = await fetch("/api/gemini/edit", {
-    method: "POST",
-    headers: {
-      "Content-Type": "application/json",
-    },
-    body: JSON.stringify({
+  const data = await postImageRequest(
+    "/api/gemini/edit",
+    {
       baseImage,
       editPrompt,
-      ratio,
       modelId,
       language,
-    }),
-  });
-
-  if (!response.ok) {
-    const errData = await response.json().catch(() => ({}));
-    throw new Error(errData.error || `HTTP error ${response.status}`);
-  }
-
-  const data = await response.json();
-  if (data.imageUrl) {
-    return await processFinalImage(data.imageUrl, ratio);
-  }
-
-  throw new Error("No image generated");
+    },
+    signal
+  );
+  return data.imageUrl;
 };
 
 export const generateOgImage = async (
@@ -151,18 +143,17 @@ export const generateOgImage = async (
   modelId: string,
   eraseTemplateSubject: boolean = true,
   lockBrandLogo: boolean = true,
-  temperature: number = 0.7,
+  // Only for models that accept it (temperatureFor); undefined otherwise.
+  temperature: number | undefined = undefined,
   aiMatting: boolean = false,
   forbidPretrainedKnowledge: boolean = true,
   imageResolution: '1K' | '2K' = '1K',
-  language: 'tc' | 'sc' = 'tc'
+  language: 'tc' | 'sc' = 'tc',
+  signal?: AbortSignal
 ) => {
-  const response = await fetch("/api/gemini/generate", {
-    method: "POST",
-    headers: {
-      "Content-Type": "application/json",
-    },
-    body: JSON.stringify({
+  const data = await postImageRequest(
+    "/api/gemini/generate",
+    {
       templateImage,
       sourceImages,
       brandLogo,
@@ -177,18 +168,8 @@ export const generateOgImage = async (
       forbidPretrainedKnowledge,
       imageResolution,
       language,
-    }),
-  });
-
-  if (!response.ok) {
-    const errData = await response.json().catch(() => ({}));
-    throw new Error(errData.error || `HTTP error ${response.status}`);
-  }
-
-  const data = await response.json();
-  if (data.imageUrl) {
-    return await processFinalImage(data.imageUrl, ratio, imageResolution);
-  }
-
-  throw new Error("No image generated");
+    },
+    signal
+  );
+  return await processFinalImage(data.imageUrl, ratio, imageResolution);
 };
diff --git a/src/lib/infocardApi.ts b/src/lib/infocardApi.ts
index d097a13..902d3a3 100644
--- a/src/lib/infocardApi.ts
+++ b/src/lib/infocardApi.ts
@@ -1,3 +1,4 @@
+import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
 import { TitleSet, InfoCardRatio, InfoCardResolution, InfoCardModel, InfoCardTextModel } from '../types/infocard';
 
 export interface AnalyzeArticleResponse {
@@ -66,24 +67,7 @@ export interface GenerateCardParams {
   language?: 'tc' | 'sc';
 }
 
-export const generateCardImage = async (params: GenerateCardParams): Promise<string> => {
-  const response = await fetch('/api/infocard/generate-card', {
-    method: 'POST',
-    headers: {
-      'Content-Type': 'application/json',
-    },
-    body: JSON.stringify(params),
-  });
-
-  if (!response.ok) {
-    const errorData = await response.json().catch(() => ({}));
-    throw new Error(errorData.error || `圖卡生成失敗 (${response.status})`);
-  }
-
-  const data = await response.json();
-  if (!data.imageUrl) {
-    throw new Error('未收到生成的圖卡圖片');
-  }
-
+export const generateCardImage = async (params: GenerateCardParams, signal?: AbortSignal): Promise<string> => {
+  const data = await postImageRequest('/api/infocard/generate-card', params, signal);
   return data.imageUrl;
 };
diff --git a/src/lib/possessionApi.ts b/src/lib/possessionApi.ts
index 097fcfd..42e9ad8 100644
--- a/src/lib/possessionApi.ts
+++ b/src/lib/possessionApi.ts
@@ -1,3 +1,4 @@
+import { postImageRequest } from '@hk01/pi-ai-extra-image-kit/browser';
 import {
   PossessionImageModel,
   PossessionTextModel,
@@ -43,23 +44,8 @@ export interface GeneratePossessionParams {
 }
 
 export const generatePossessionOg = async (
-  params: GeneratePossessionParams
+  params: GeneratePossessionParams,
+  signal?: AbortSignal
 ): Promise<{ imageUrl: string; metadata?: any }> => {
-  const response = await fetch('/api/possession/generate', {
-    method: 'POST',
-    headers: { 'Content-Type': 'application/json' },
-    body: JSON.stringify(params),
-  });
-
-  if (!response.ok) {
-    const errorData = await response.json().catch(() => ({}));
-    throw new Error(errorData.error || `OG 奪舍生成失敗 (${response.status})`);
-  }
-
-  const data = await response.json();
-  if (!data.imageUrl) {
-    throw new Error('未收到生成的 OG 奪舍圖片');
-  }
-
-  return data;
+  return await postImageRequest('/api/possession/generate', params, signal);
 };
```

Replace the whole content of `src/lib/pricing.ts` with this. Prices come from the selected model's verified price; a model without one is stored as `-1` ("未計價"), because Firestore requires a number in `costHKD`:

```ts
import { estimateImageCostUsd, type ImageModelView, type OutputResolution } from '@hk01/pi-ai-extra-image-kit';

const EXCHANGE_RATE = 7.78;

/**
 * Stored as costHKD when the model has no verified price. History documents must keep a numeric
 * costHKD (Firestore rules), so unpriced images use this marker and totals skip them.
 */
export const UNPRICED_COST_HKD = -1;

/** Estimated HK$ for one image from the model's verified price, or UNPRICED_COST_HKD. */
export const calculateCost = (
  model: ImageModelView | undefined,
  input: { resolution: OutputResolution; inputImages: number; promptChars: number }
): number => {
  const usd = estimateImageCostUsd(model, input);
  return usd === null ? UNPRICED_COST_HKD : usd * EXCHANGE_RATE;
};

export const isPriced = (costHKD: number): boolean => costHKD >= 0;

/** "HK$ 0.52", or "—" for an unpriced image. */
export const formatCost = (costHKD: number): string => (isPriced(costHKD) ? `HK$ ${costHKD.toFixed(2)}` : '—');

/** Sum of the priced items and the number of unpriced ones. */
export const sumCosts = (costs: readonly number[]): { totalHKD: number; unpriced: number } => ({
  totalHKD: costs.filter(isPriced).reduce((sum, cost) => sum + cost, 0),
  unpriced: costs.filter((cost) => !isPriced(cost)).length,
});
```

## Step 11: `src/components/TokenHistory.tsx`

Show unpriced images as 「—」, count them separately, and take model names from the model list:

```diff
diff --git a/src/components/TokenHistory.tsx b/src/components/TokenHistory.tsx
index 1a80bc7..2ab2af0 100644
--- a/src/components/TokenHistory.tsx
+++ b/src/components/TokenHistory.tsx
@@ -3,6 +3,8 @@ import { X } from 'lucide-react';
 import { Button } from './ui/Button';
 import { GeneratedImage } from '../store';
 import { format } from 'date-fns';
+import { findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
+import { formatCost, sumCosts } from '../lib/pricing';
 
 interface TokenHistoryProps {
   history: GeneratedImage[];
@@ -11,17 +13,19 @@ interface TokenHistoryProps {
 
 export function TokenHistory({ history, onClose }: TokenHistoryProps) {
   const currentMonth = new Date().getMonth();
+  const { models } = useImageModels();
+  // Removed models (for example OpenRouter) have no entry any more; their id is shown instead.
+  const modelLabel = (id: string) => findImageModel(models, id)?.label ?? id;
   
-  const monthlyCost = history
+  const monthlyCost = sumCosts(history
     .filter(h => new Date(h.timestamp).getMonth() === currentMonth)
-    .reduce((sum, h) => sum + h.costHKD, 0);
+    .map(h => h.costHKD));
 
-  const dailyStats = history.reduce((acc, curr) => {
+  const dailyCosts = history.reduce((acc, curr) => {
     const date = format(curr.timestamp, 'yyyy-MM-dd');
-    if (!acc[date]) acc[date] = 0;
-    acc[date] += curr.costHKD;
-    return acc;
-  }, {} as Record<string, number>);
+    return { ...acc, [date]: [...(acc[date] ?? []), curr.costHKD] };
+  }, {} as Record<string, number[]>);
+  const dailyStats = Object.fromEntries(Object.entries(dailyCosts).map(([date, costs]) => [date, sumCosts(costs)]));
 
   return (
     <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
@@ -36,7 +40,10 @@ export function TokenHistory({ history, onClose }: TokenHistoryProps) {
         <div className="p-6 overflow-y-auto space-y-8">
           <div className="bg-zinc-50 p-6 rounded-xl border border-zinc-200 text-center">
             <h3 className="text-sm font-medium text-zinc-500 mb-2">本月累計費用</h3>
-            <p className="text-4xl font-bold text-zinc-900">HK$ {monthlyCost.toFixed(2)}</p>
+            <p className="text-4xl font-bold text-zinc-900">HK$ {monthlyCost.totalHKD.toFixed(2)}</p>
+            {monthlyCost.unpriced > 0 && (
+              <p className="text-xs text-zinc-500 mt-2">另有 {monthlyCost.unpriced} 張未計價（該模型沒有查證過的單價）</p>
+            )}
           </div>
 
           <div>
@@ -45,7 +52,10 @@ export function TokenHistory({ history, onClose }: TokenHistoryProps) {
               {Object.entries(dailyStats).sort((a, b) => b[0].localeCompare(a[0])).map(([date, cost]) => (
                 <div key={date} className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                   <span className="font-medium">{date}</span>
-                  <span className="text-zinc-600">HK$ {cost.toFixed(2)}</span>
+                  <span className="text-zinc-600">
+                    HK$ {cost.totalHKD.toFixed(2)}
+                    {cost.unpriced > 0 && <span className="text-zinc-400">（{cost.unpriced} 張未計價）</span>}
+                  </span>
                 </div>
               ))}
               {Object.keys(dailyStats).length === 0 && (
@@ -62,10 +72,10 @@ export function TokenHistory({ history, onClose }: TokenHistoryProps) {
                   <div>
                     <p className="font-medium">{format(item.timestamp, 'yyyy-MM-dd HH:mm:ss')}</p>
                     <p className="text-zinc-500 text-xs mt-1">
-                      模型: {item.model === 'nano-banana-pro' ? 'Nano Banana Pro' : item.model === 'gpt-image-2' ? 'GPT Image 2 (ToAPIs)' : item.model === 'doubao-seedream-5-0' ? 'Doubao Seedream 5.0 (ToAPIs)' : item.model === 'openrouter-gpt-image-2' ? 'GPT Image 2 (OpenRouter)' : 'Nano Banana 2'} | 比例: {item.ratio}
+                      模型: {modelLabel(item.model)} | 比例: {item.ratio}
                     </p>
                   </div>
-                  <span className="font-semibold text-zinc-700">HK$ {item.costHKD.toFixed(2)}</span>
+                  <span className="font-semibold text-zinc-700">{formatCost(item.costHKD)}</span>
                 </div>
               ))}
               {history.length === 0 && (
```

## Step 12: `src/components/DeepEditor.tsx`

The server now keeps the image's aspect ratio and size, so the ratio guessing goes. Send the language, report errors to the error panel, and show the mask note for models that only see strokes as a reference image:

```diff
diff --git a/src/components/DeepEditor.tsx b/src/components/DeepEditor.tsx
index 8a0ec2b..64037b0 100644
--- a/src/components/DeepEditor.tsx
+++ b/src/components/DeepEditor.tsx
@@ -10,6 +10,10 @@ import { Input } from './ui/Input';
 import ReactCrop, { type Crop as CropType } from 'react-image-crop';
 import 'react-image-crop/dist/ReactCrop.css';
 import { downloadImage } from '../lib/utils';
+import { useLanguage } from '../contexts/LanguageContext';
+import { findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
+import { MASK_REFERENCE_ONLY_NOTE } from '@hk01/pi-ai-extra-image-kit';
+import { reportError } from '@hk01/pi-ai-extra-image-kit/browser';
 
 interface DeepEditorProps {
   imageUrl: string;
@@ -87,6 +91,9 @@ export function DeepEditor({ imageUrl, modelId, onClose, onConfirm }: DeepEditor
   const [history, setHistory] = useState<ImageData[]>([]);
   
   const [isProcessing, setIsProcessing] = useState(false);
+  const { language } = useLanguage();
+  const { models: imageModels } = useImageModels();
+  const editModel = findImageModel(imageModels, modelId);
 
   useEffect(() => {
     const canvas = canvasRef.current;
@@ -409,17 +416,6 @@ export function DeepEditor({ imageUrl, modelId, onClose, onConfirm }: DeepEditor
       
       const { editOgImage } = await import('../lib/gemini');
       
-      const getRatioString = (width: number, height: number) => {
-        const r = width / height;
-        if (r > 1.5) return "16:9";
-        if (r > 1.15) return "4:3";
-        if (r > 0.85) return "1:1";
-        if (r > 0.77) return "4:5";
-        if (r > 0.65) return "3:4";
-        return "9:16";
-      };
-      const imageRatio = getRatioString(canvas.width, canvas.height);
-      
       let editPrompt = `GLOBAL EDIT: ${globalPrompt}\n`;
       COLORS.forEach(c => {
         if (colorPrompts[c.id]) {
@@ -427,11 +423,12 @@ export function DeepEditor({ imageUrl, modelId, onClose, onConfirm }: DeepEditor
         }
       });
       
+      // The server keeps the canvas's aspect ratio and pixel size.
       const resultUrl = await editOgImage(
         editedImageUrl,
         editPrompt,
-        imageRatio,
-        modelId
+        modelId,
+        language
       );
       
       setCurrentImageUrl(resultUrl);
@@ -439,8 +436,7 @@ export function DeepEditor({ imageUrl, modelId, onClose, onConfirm }: DeepEditor
       setColorPrompts({});
     } catch (error) {
       console.error("Edit failed:", error);
-      const errorMessage = error instanceof Error ? error.message : String(error);
-      alert(`編輯失敗：${errorMessage}`);
+      reportError(error, '圖片編輯');
     } finally {
       setIsProcessing(false);
     }
@@ -860,6 +856,11 @@ export function DeepEditor({ imageUrl, modelId, onClose, onConfirm }: DeepEditor
 
             {/* Bottom Actions Footer */}
             <div className="p-4 border-t border-zinc-200 bg-white space-y-2 shrink-0">
+              {activeTab === 'draw' && editModel?.maskEditing === 'reference-only' && (
+                <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
+                  {MASK_REFERENCE_ONLY_NOTE}
+                </p>
+              )}
               {activeTab === 'draw' && (
                 <Button 
                   className="w-full bg-zinc-900 hover:bg-black text-white"
```

## Step 13: `src/App.tsx` (OG 拼貼)

Apply this diff:

- The header model `<select>` becomes `ImageModelSelector` (grouped by provider, models that cannot take the images are disabled).
- The Temperature slider is disabled with a note for models that do not accept temperature; the saved value is kept and only sent with `temperatureFor`.
- Generation waits until the model list has loaded, sends the language, can be cancelled (the 「取消」 button had no handler), estimates the cost from the model's price, and reports failures to the error panel instead of `alert`.
- With two ratios selected, each ratio is its own request: a failed ratio is reported and the other one still runs.
- A failed history save is reported as 「儲存生成紀錄」, not as a failed generation (the image was made and billed).
- Remove the unused client import of `@google/genai`.

```diff
diff --git a/src/App.tsx b/src/App.tsx
index 406bd2b..2022fa1 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -12,13 +12,16 @@ import { BatchExpert } from './components/batch/BatchExpert';
 import { PossessionExpert } from './components/possession/PossessionExpert';
 import { Settings, Image as ImageIcon, Download, Trash2, Info, Loader2, LogOut, ChevronDown, Sliders, Scissors, DatabaseZap, Sparkles, Palette, Layers, Zap, X, Globe } from 'lucide-react';
 import confetti from 'canvas-confetti';
-import { GoogleGenAI } from '@google/genai';
 import { Login } from './components/Login';
 import { useLanguage } from './contexts/LanguageContext';
 import { auth, db, logout, OperationType, handleFirestoreError } from './firebase';
 import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
 import { downloadImage } from './lib/utils';
 import { onAuthStateChanged, User } from 'firebase/auth';
+import { ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
+import { TEMPERATURE_SUPPORT_NOTE, selectedModelIssue, temperatureFor } from '@hk01/pi-ai-extra-image-kit';
+import { isAbort, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
+import { calculateCost, sumCosts } from './lib/pricing';
 
 export type VisualTheme = 'rose' | 'blue';
 
@@ -35,13 +38,7 @@ const RATIOS = [
   { id: '320x480', label: '320 x 480px（廣告專用）', width: 320, height: 480 },
 ];
 
-const MODELS = [
-  { id: 'nano-banana-2', label: 'Nano Banana 2', description: '預設模型，生成速度快，適合一般拼貼。' },
-  { id: 'nano-banana-pro', label: 'Nano Banana Pro', description: '進階模型，細節更豐富，適合高要求圖片。' },
-  { id: 'gpt-image-2', label: 'GPT Image 2 (ToAPIs)', description: 'ToAPIs 提供之 GPT 圖片模型，高創意度與畫面品質。' },
-  { id: 'openrouter-gpt-image-2', label: 'GPT Image 2 (OpenRouter)', description: 'OpenRouter 提供之 GPT Image 2 圖片模型。' },
-  { id: 'doubao-seedream-5-0', label: 'Doubao Seedream 5.0 (ToAPIs)', description: 'ByteDance 豆包最新 Seedream 5.0 圖像模型，支援 2K/3K 超高畫質與強大畫面表現力。' },
-];
+const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';
 
 const compressBase64Image = (base64Str: string | null): Promise<string | null> => {
   if (!base64Str) return Promise.resolve(null);
@@ -138,6 +135,8 @@ export default function App() {
   const [isCustomMangaModalOpen, setIsCustomMangaModalOpen] = useState(false);
   const [currentTab, setCurrentTab] = useState<'batch' | 'infocard' | 'og' | 'possession'>('possession');
   const { language, setLanguage } = useLanguage();
+  const imageModels = useImageModels();
+  const generateAbortRef = useRef<AbortController | null>(null);
   const [ogImportToast, setOgImportToast] = useState<string | null>(null);
   const [visualTheme, setVisualTheme] = useState<VisualTheme>(() => {
     try {
@@ -406,9 +405,14 @@ export default function App() {
     setEditingImage(null);
   };
 
-  const currentMonthCost = state.history
+  const currentMonthCost = sumCosts(state.history
     .filter(h => new Date(h.timestamp).getMonth() === new Date().getMonth())
-    .reduce((sum, h) => sum + h.costHKD, 0);
+    .map(h => h.costHKD));
+  // Template + source images + brand logo, as sent by /api/gemini/generate
+  const ogReferenceCount = 1 + state.sourceImages.length + (state.brandLogo ? 1 : 0);
+  const ogImageModel = findImageModel(imageModels.models, state.selectedModel);
+  // Also set while the model list is loading, so temperature and price are known when generating.
+  const ogModelIssue = selectedModelIssue(ogImageModel, { referenceCount: ogReferenceCount });
 
   const handleSendImageToOg = (imageUrl: string) => {
     updateState({
@@ -493,10 +497,11 @@ export default function App() {
   const handleGenerate = async () => {
     if (!state?.templateImage || state.sourceImages.length === 0 || state.selectedRatios.length === 0) return;
     
+    const controller = new AbortController();
+    generateAbortRef.current = controller;
     setIsGenerating(true);
     try {
       const { generateOgImage } = await import('./lib/gemini');
-      const { calculateCost } = await import('./lib/pricing');
       const { v4: uuidv4 } = await import('uuid');
 
       // Pre-compress images before sending over network to avoid high payload timeout
@@ -506,65 +511,90 @@ export default function App() {
       );
       const compressedLogo = await compressBase64Image(state.brandLogo);
       
-      for (const ratioId of state.selectedRatios) {
-        const ratioPrompt = state.ratioPrompts[ratioId] || '';
-        const inputImagesCount = 1 + state.sourceImages.length + (state.brandLogo ? 1 : 0);
-        const currentResolution = state.imageResolution ?? '1K';
-        const costHKD = calculateCost(state.selectedModel, inputImagesCount, currentResolution);
-        
-        const imageUrl = await generateOgImage(
-          compressedTemplate,
-          compressedSources,
-          compressedLogo,
-          state.globalPrompt,
-          ratioPrompt,
-          ratioId,
-          state.selectedModel,
-          state.eraseTemplateSubject ?? true,
-          state.lockBrandLogo ?? true,
-          state.temperature ?? 0.7,
-          state.aiMatting ?? false,
-          state.forbidPretrainedKnowledge ?? true,
-          currentResolution
-        );
-
-        const newId = uuidv4();
-        const newItem: GeneratedImage = {
-          id: newId,
-          url: imageUrl,
-          ratio: ratioId,
-          timestamp: Date.now(),
-          costHKD,
-          model: state.selectedModel,
-          resolution: currentResolution,
-        };
-
-        // Always update local state history immediately so generated result is shown in UI instantly
-        setState(prev => {
-          if (!prev) return prev;
-          if (prev.history.some(h => h.id === newId)) return prev;
-          return {
-            ...prev,
-            history: [newItem, ...prev.history],
+      // One ratio at a time; a failed ratio is reported and the next one still runs (no retry, no other model).
+      for (const [index, ratioId] of state.selectedRatios.entries()) {
+        if (controller.signal.aborted) break;
+        try {
+          const ratioPrompt = state.ratioPrompts[ratioId] || '';
+          const currentResolution = state.imageResolution ?? '1K';
+          const costHKD = calculateCost(ogImageModel, {
+            resolution: currentResolution,
+            inputImages: ogReferenceCount,
+            promptChars: state.globalPrompt.length + ratioPrompt.length,
+          });
+          
+          const imageUrl = await generateOgImage(
+            compressedTemplate,
+            compressedSources,
+            compressedLogo,
+            state.globalPrompt,
+            ratioPrompt,
+            ratioId,
+            state.selectedModel,
+            state.eraseTemplateSubject ?? true,
+            state.lockBrandLogo ?? true,
+            temperatureFor(ogImageModel, state.temperature ?? 0.7),
+            state.aiMatting ?? false,
+            state.forbidPretrainedKnowledge ?? true,
+            currentResolution,
+            language,
+            controller.signal
+          );
+
+          const newId = uuidv4();
+          const newItem: GeneratedImage = {
+            id: newId,
+            url: imageUrl,
+            ratio: ratioId,
+            timestamp: Date.now(),
+            costHKD,
+            model: state.selectedModel,
+            resolution: currentResolution,
           };
-        });
 
-        if (user) {
-          const itemRef = doc(db, 'users', user.uid, 'history', newId);
-          await setDoc(itemRef, newItem).catch(e => {
-            handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/history/${newId}`);
+          // Always update local state history immediately so generated result is shown in UI instantly
+          setState(prev => {
+            if (!prev) return prev;
+            if (prev.history.some(h => h.id === newId)) return prev;
+            return {
+              ...prev,
+              history: [newItem, ...prev.history],
+            };
+          });
+
+          if (user) {
+            const itemRef = doc(db, 'users', user.uid, 'history', newId);
+            await setDoc(itemRef, newItem).catch(e => {
+              // The image was generated (and billed); only saving its history entry failed.
+              try {
+                handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/history/${newId}`);
+              } catch (saveError) {
+                reportError(saveError, '儲存生成紀錄', { 比例: ratioId });
+              }
+            });
+          }
+        } catch (error) {
+          if (isAbort(error, controller.signal)) break;
+          console.error("Generation failed:", error);
+          reportError(error, 'OG 拼貼生成', {
+            比例: `第 ${index + 1}/${state.selectedRatios.length} 張 (${ratioId})`,
           });
         }
       }
     } catch (error) {
       console.error("Generation failed:", error);
-      const errorMessage = error instanceof Error ? error.message : String(error);
-      alert(`生成失敗，請稍後再試或檢查您的 API Key。\n錯誤詳情: ${errorMessage}`);
+      reportError(error, 'OG 拼貼生成');
     } finally {
+      generateAbortRef.current = null;
       setIsGenerating(false);
     }
   };
 
+  // Stops the request in progress; the server stops polling the provider (a submitted task is still billed).
+  const handleCancelGenerate = () => {
+    generateAbortRef.current?.abort();
+  };
+
   if (!isAuthReady) {
     return (
       <div className="min-h-screen flex items-center justify-center bg-zinc-50">
@@ -748,18 +778,18 @@ export default function App() {
           {currentTab === 'og' && (
             <div className="flex items-center gap-2">
               <div className="relative flex items-center">
-                <select
+                <ImageModelSelector
+                  models={imageModels.models}
+                  loading={imageModels.loading}
+                  failed={imageModels.failed}
+                  onReload={imageModels.reload}
                   value={state.selectedModel}
-                  onChange={(e) => updateState({ selectedModel: e.target.value as any })}
+                  onChange={(id) => updateState({ selectedModel: id })}
+                  defaultModelId={DEFAULT_IMAGE_MODEL_ID}
+                  needs={{ referenceCount: ogReferenceCount }}
                   className="border text-white text-xs font-semibold rounded-xl pl-3 pr-7 py-1.5 focus:outline-none focus:ring-2 cursor-pointer transition-all appearance-none bg-black/40 border-white/20 hover:bg-black/50 focus:ring-sky-400"
-                  title={MODELS.find(m => m.id === state.selectedModel)?.description}
-                >
-                  {MODELS.map((model) => (
-                    <option key={model.id} value={model.id} className="bg-slate-900 text-white">
-                      {model.label}
-                    </option>
-                  ))}
-                </select>
+                  optionClassName="bg-slate-900 text-white"
+                />
                 <ChevronDown className="w-3.5 h-3.5 text-slate-300 absolute right-2 pointer-events-none" />
               </div>
 
@@ -805,7 +835,8 @@ export default function App() {
               : 'bg-black/35 border-rose-500/30 text-slate-300'
           }`}>
             <span className="text-slate-300">
-              本月: <b className="text-emerald-400 font-black tracking-wide">HK$ {currentMonthCost.toFixed(2)}</b>
+              本月: <b className="text-emerald-400 font-black tracking-wide">HK$ {currentMonthCost.totalHKD.toFixed(2)}</b>
+              {currentMonthCost.unpriced > 0 && <span className="text-slate-400">（另有 {currentMonthCost.unpriced} 張未計價）</span>}
             </span>
             <button 
               onClick={() => setShowTokenHistory(true)}
@@ -1113,10 +1144,17 @@ export default function App() {
                   step="0.1"
                   value={state.temperature ?? 0.7}
                   onChange={(e) => updateState({ temperature: parseFloat(e.target.value) })}
-                  className="w-full h-2.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-700 transition-all"
+                  disabled={ogImageModel !== undefined && ogImageModel.temperature === null}
+                  className="w-full h-2.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-700 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                 />
               </div>
 
+              {ogImageModel && ogImageModel.temperature === null && (
+                <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
+                  目前模型「{ogImageModel.label}」不使用 Temperature，生成時不會送出此設定（數值會保留）。{TEMPERATURE_SUPPORT_NOTE}
+                </p>
+              )}
+
               <div className="flex justify-between text-[11px] font-semibold text-zinc-500 px-0.5">
                 <span>0.0 (0級：極嚴格收斂)</span>
                 <span className="text-indigo-600 font-bold">0.7 (7級：預設平衡)</span>
@@ -1306,7 +1344,7 @@ export default function App() {
               : 'bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700'
           }`}
           onClick={handleGenerate}
-          disabled={isGenerating || !state.templateImage || state.sourceImages.length === 0 || state.selectedRatios.length === 0}
+          disabled={isGenerating || ogModelIssue !== null || !state.templateImage || state.sourceImages.length === 0 || state.selectedRatios.length === 0}
         >
           {isGenerating ? (
             <>
@@ -1316,10 +1354,11 @@ export default function App() {
           ) : '開始生成'}
         </Button>
         {isGenerating && (
-          <Button variant="destructive" size="lg" className="rounded-xl">
+          <Button variant="destructive" size="lg" className="rounded-xl" onClick={handleCancelGenerate}>
             取消
           </Button>
         )}
+        <ImageModelIssue model={ogImageModel} needs={{ referenceCount: ogReferenceCount }} className="max-w-xs text-xs font-semibold text-red-600" />
       </div>
       </>
       )}
```

## Step 14: check Part 2

1. `npm run lint` passes.
2. No file under `src/` reads `process.env` or imports `@hk01/pi-ai-extra-image-kit/server`, and `vite.config.ts` has no `define`.
3. Reply with a summary of every file you changed.
