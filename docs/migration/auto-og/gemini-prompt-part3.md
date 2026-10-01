# Auto OG migration, Part 3 of 3: wire the UI

Continue the same task (Parts 1 and 2 are already applied). The rules from Part 1 still apply.

## Step 10: `services/geminiService.ts`

Apply this diff. It:
- removes the unused `@google/genai` import. The browser never calls Gemini.
- removes the client-side ratio and quality helpers. `shared/imageOutput.ts` is now the single size table.
- makes `resizeAndConvertToJpeg` centre-crop instead of stretching. Before, 4:5 output was generated as 3:4 and stretched by about 7%.
- turns `generateCollage` and `editImage` into functions that take **one options object**, and makes them read the NDJSON stream through `postImageRequest`.

The old 15-argument positional call was misaligned in the manual studio, `App.tsx`: the model, the temperature and the title settings arrived in the wrong parameters. The options object removes that bug.

```diff
diff --git a/services/geminiService.ts b/services/geminiService.ts
index 37269e2..719be82 100644
--- a/services/geminiService.ts
+++ b/services/geminiService.ts
@@ -1,5 +1,6 @@
-import { GoogleGenAI } from "@google/genai";
-import { AspectRatio, ImageQuality, TitleConfig, ImageAsset, TitleConfigItem } from "../types";
+import { AspectRatio, TitleConfig, ImageAsset, TitleConfigItem } from "../types";
+import { outputSpec } from "../shared/imageOutput";
+import { postImageRequest } from "./imageApi";
 
 // Helper to convert File to Base64 with resizing to prevent 413 errors
 export const fileToBase64 = (file: File): Promise<ImageAsset> => {
@@ -79,9 +80,14 @@ export const resizeAndConvertToJpeg = (dataUrl: string, targetWidth: number, tar
       // Draw background white (for transparency handling if any)
       ctx.fillStyle = '#FFFFFF';
       ctx.fillRect(0, 0, targetWidth, targetHeight);
-      
-      // Draw image stretch to fit strict dimensions
-      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
+
+      // Centre-crop to the target ratio, then scale (never stretch: models may return a nearby ratio)
+      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
+      const cropW = targetWidth / scale;
+      const cropH = targetHeight / scale;
+      ctx.imageSmoothingEnabled = true;
+      ctx.imageSmoothingQuality = 'high';
+      ctx.drawImage(img, (img.width - cropW) / 2, (img.height - cropH) / 2, cropW, cropH, 0, 0, targetWidth, targetHeight);
       
       // Force JPEG quality 0.9
       resolve(canvas.toDataURL('image/jpeg', 0.9));
@@ -202,35 +208,6 @@ const urlToAsset = async (url: string): Promise<ImageAsset> => {
     return fileToBase64(new File([blob], "temp", { type: blob.type }));
 };
 
-const mapRatioToSupported = (ratio: AspectRatio): string => {
-  switch (ratio) {
-    case '4:5': return '3:4';
-    case '300x250': return '4:3';
-    case '320x250': return '4:3';
-    case '300x300': return '1:1';
-    default: return ratio;
-  }
-};
-
-const getTargetDimensions = (ratio: AspectRatio): { width: number, height: number } => {
-  switch (ratio) {
-    case '16:9': return { width: 1200, height: 675 };
-    case '4:5': return { width: 1600, height: 2000 };
-    case '9:16': return { width: 1080, height: 1920 };
-    case '1:1': return { width: 1080, height: 1080 };
-    case '300x250': return { width: 300, height: 250 };
-    case '320x250': return { width: 300, height: 250 };
-    case '300x300': return { width: 300, height: 300 };
-    default: return { width: 1024, height: 1024 };
-  }
-};
-
-// We ignore the quality param effectively because we are doing post-process resizing to high res
-const mapQualityToSize = (quality: ImageQuality): string => {
-  // Request '2K' from Gemini to ensure we have enough pixels to downscale nicely to 1600/1800
-  return '2K'; 
-};
-
 // Helper to fetch article full text from URL
 export const fetchArticleText = async (url: string): Promise<{ title: string; content: string }> => {
   const response = await fetch('/api/fetch-article', {
@@ -305,105 +282,78 @@ export const generateViralTitles = async (
   return titles;
 };
 
-export const generateCollage = async (
-  templateAssets: ImageAsset[],
-  sourceAssets: ImageAsset[],
-  prompt: string,
-  ratio: AspectRatio,
-  quality: ImageQuality,
-  strictFidelity: boolean = false,
-  preserveBackground: boolean = false,
-  removeBackground: boolean = false,
-  copyLogo: boolean = false,
-  prohibitLogo: boolean = true,
-  prohibitPretrainedLogo: boolean = true,
-  eraseText: boolean = true,
-  titleConfig?: TitleConfig,
-  selectedModel: 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-2-lite' = 'nano-banana-pro',
-  temperature: number = 0.7
-): Promise<string> => {
-  const payload = {
-    templateAssets,
-    sourceAssets,
-    prompt,
-    ratio,
-    quality,
-    strictFidelity,
-    preserveBackground,
-    removeBackground,
-    copyLogo,
-    prohibitLogo,
-    prohibitPretrainedLogo,
-    eraseText,
-    titleConfig,
-    selectedModel,
-    temperature
-  };
-
-  const response = await fetch('/api/generate-collage', {
-    method: 'POST',
-    headers: {
-      'Content-Type': 'application/json'
-    },
-    body: JSON.stringify(payload)
-  });
-
-  if (!response.ok) {
-    const data = await response.json().catch(() => ({}));
-    const errorMsg = data.error || `Server returned status ${response.status}: ${response.statusText}`;
-    throw new Error(errorMsg);
-  }
+export interface CollageRequest {
+  templateAssets: ImageAsset[];
+  sourceAssets: ImageAsset[];
+  prompt: string;
+  ratio: AspectRatio;
+  strictFidelity?: boolean;
+  preserveBackground?: boolean;
+  removeBackground?: boolean;
+  copyLogo?: boolean;
+  prohibitLogo?: boolean;
+  prohibitPretrainedLogo?: boolean;
+  eraseText?: boolean;
+  titleConfig?: TitleConfig;
+  /** App image model id from GET /api/image-models. */
+  selectedModel: string;
+  /** Only for models that accept temperature; the server rejects it for the others. */
+  temperature?: number;
+}
 
-  const { rawImageBase64 } = await response.json();
-  if (!rawImageBase64) {
-    throw new Error("No image was returned from server collage generation.");
-  }
+/** Generates one collage with the selected model (one attempt, no fallback) and post-processes it to the ratio's size. */
+export const generateCollage = async (request: CollageRequest): Promise<string> => {
+  const rawImageBase64 = await postImageRequest('/api/generate-collage', {
+    templateAssets: request.templateAssets,
+    sourceAssets: request.sourceAssets,
+    prompt: request.prompt,
+    ratio: request.ratio,
+    strictFidelity: request.strictFidelity ?? false,
+    preserveBackground: request.preserveBackground ?? false,
+    removeBackground: request.removeBackground ?? false,
+    copyLogo: request.copyLogo ?? false,
+    prohibitLogo: request.prohibitLogo ?? true,
+    prohibitPretrainedLogo: request.prohibitPretrainedLogo ?? true,
+    eraseText: request.eraseText ?? true,
+    titleConfig: request.titleConfig,
+    selectedModel: request.selectedModel,
+    temperature: request.temperature,
+  });
 
   // Post-Processing: Resize to strictly requested dimensions and convert to JPEG on the client side
-  const dimensions = getTargetDimensions(ratio);
-  if (ratio === '300x250' || ratio === '320x250') {
+  const dimensions = outputSpec(request.ratio);
+  if (request.ratio === '300x250' || request.ratio === '320x250') {
     return await cropAndResizeFor300x250(rawImageBase64, dimensions.width, dimensions.height);
   }
   return await resizeAndConvertToJpeg(rawImageBase64, dimensions.width, dimensions.height);
 };
 
-export const editImage = async (
-  imageUrl: string,
-  maskBase64: string | null,
-  prompt: string,
-  isMultiMask: boolean = false,
-  selectedModel: 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-2-lite' = 'nano-banana-pro',
-  temperature: number = 0.7,
-  extraImageBase64?: string | null
-): Promise<string> => {
-  const payload = {
-    imageUrl,
-    maskBase64,
-    prompt,
-    isMultiMask,
-    selectedModel,
-    temperature,
-    extraImageBase64
-  };
-
-  const response = await fetch('/api/edit-image', {
-    method: 'POST',
-    headers: {
-      'Content-Type': 'application/json'
-    },
-    body: JSON.stringify(payload)
-  });
-
-  if (!response.ok) {
-    const data = await response.json().catch(() => ({}));
-    const errorMsg = data.error || `Server returned status ${response.status}: ${response.statusText}`;
-    throw new Error(errorMsg);
-  }
+export interface EditRequest {
+  imageUrl: string;
+  maskBase64: string | null;
+  prompt: string;
+  isMultiMask?: boolean;
+  /** App image model id from GET /api/image-models. */
+  selectedModel: string;
+  extraImageBase64?: string | null;
+  /** "width:height" of the image being edited, so models without "keep input aspect" use the nearest ratio. */
+  sourceAspect?: string;
+  /** Only for models that accept temperature; omitted means the server's edit default (0.7) on those models. */
+  temperature?: number;
+}
 
-  const { rawImageBase64 } = await response.json();
-  if (!rawImageBase64) {
-    throw new Error("No image was returned from server image editing.");
-  }
+/** Edits one image with the selected model (one attempt, no fallback). */
+export const editImage = async (request: EditRequest): Promise<string> => {
+  const rawImageBase64 = await postImageRequest('/api/edit-image', {
+    imageUrl: request.imageUrl,
+    maskBase64: request.maskBase64,
+    prompt: request.prompt,
+    isMultiMask: request.isMultiMask ?? false,
+    selectedModel: request.selectedModel,
+    extraImageBase64: request.extraImageBase64 ?? null,
+    sourceAspect: request.sourceAspect,
+    temperature: request.temperature,
+  });
 
   // Convert edited image to JPEG as well to match system standard
   return new Promise((resolve) => {
```


## Step 11: `services/usageService.ts`

Apply this diff. `trackTransaction` now takes the estimated cost of one request, from `estimateCostUsd`, instead of the old hard-coded Google prices.
- The old code charged input at $5 per 1M tokens. Google's list price is $0.50 for Nano Banana 2 and $2.00 for Pro.
- Images from models without a known price are counted as `unpricedImages` and are not added to the cost.

```diff
diff --git a/services/usageService.ts b/services/usageService.ts
index 9bff04e..4099630 100644
--- a/services/usageService.ts
+++ b/services/usageService.ts
@@ -6,6 +6,8 @@ export interface MonthlyUsageData {
   totalCostHKD: number;
   requestCount: number;
   lastUpdated: number;
+  /** Images from models without a known price; not included in the cost totals. */
+  unpricedImages?: number;
 }
 
 export interface UsageHistory {
@@ -14,9 +16,7 @@ export interface UsageHistory {
 
 const STORAGE_KEY = 'og_collage_usage_history';
 
-// Pricing Constants (Aligned with App.tsx estimation)
-const PRICE_PER_1M_INPUT_TOKENS_USD = 5.00;
-const PRICE_PER_OUTPUT_IMAGE_USD = 0.134;
+// Estimates only: prices come from GET /api/image-models (see shared/imageModels.ts estimateCostUsd).
 const HKD_EXCHANGE_RATE = 7.8;
 
 export const UsageService = {
@@ -53,53 +53,25 @@ export const UsageService = {
     return history[yearMonth];
   },
 
-  // Record a transaction
-  trackTransaction: (
-    inputTokens: number, 
-    outputImages: number, 
-    selectedModel: 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-2-lite' = 'nano-banana-pro',
-    quality: '1K' | '2K' = '1K'
-  ) => {
+  // Record an estimated transaction. costUsd is null when the model's price is unknown.
+  trackTransaction: (inputTokens: number, outputImages: number, costUsd: number | null) => {
     const history = UsageService.getHistory();
     const currentKey = UsageService.getCurrentMonthKey();
-    
-    // Initialize if needed
-    if (!history[currentKey]) {
-      history[currentKey] = {
-        inputTokens: 0,
-        outputImages: 0,
-        totalCostUSD: 0,
-        totalCostHKD: 0,
-        requestCount: 0,
-        lastUpdated: Date.now()
-      };
-    }
-
-    // Calculate Costs for this specific transaction based on the model selected and quality
-    let pricePerImage = 0.134;
-    if (selectedModel === 'nano-banana-2-lite') {
-      pricePerImage = quality === '1K' ? 0.034 : 0.050;
-    } else if (selectedModel === 'nano-banana-2') {
-      pricePerImage = quality === '1K' ? 0.067 : 0.101;
-    } else {
-      pricePerImage = 0.134;
-    }
-    const inputCost = (inputTokens / 1000000) * PRICE_PER_1M_INPUT_TOKENS_USD;
-    const outputCost = outputImages * pricePerImage;
-    const totalTxCostUSD = inputCost + outputCost;
-    const totalTxCostHKD = totalTxCostUSD * HKD_EXCHANGE_RATE;
-
-    // Update Accumulators
-    history[currentKey].inputTokens += inputTokens;
-    history[currentKey].outputImages += outputImages;
-    history[currentKey].totalCostUSD += totalTxCostUSD;
-    history[currentKey].totalCostHKD += totalTxCostHKD;
-    history[currentKey].requestCount += 1;
-    history[currentKey].lastUpdated = Date.now();
+    const current = history[currentKey] ?? UsageService.getMonthData(currentKey);
+    const txCostUSD = costUsd ?? 0;
+    const updated: MonthlyUsageData = {
+      ...current,
+      inputTokens: current.inputTokens + inputTokens,
+      outputImages: current.outputImages + outputImages,
+      totalCostUSD: current.totalCostUSD + txCostUSD,
+      totalCostHKD: current.totalCostHKD + txCostUSD * HKD_EXCHANGE_RATE,
+      requestCount: current.requestCount + 1,
+      lastUpdated: Date.now(),
+      unpricedImages: (current.unpricedImages ?? 0) + (costUsd === null ? outputImages : 0),
+    };
 
-    // Save
     try {
-      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
+      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...history, [currentKey]: updated }));
     } catch (e) {
       console.error("Failed to save usage history", e);
     }
```


## Step 12: `App.tsx`

Apply this diff. It:
- **Selector:** replaces the two-option Gemini `<select>` in the top bar with `ImageModelSelector`, fed by `useImageModels()`. Its options are disabled using the reference count of the visible studio: manual uses the selected templates plus the sources; Autopilot reports its own count.
- **Model state:** stores the selected model as a string id, and resets an unknown id (such as the removed `nano-banana-2-lite`) to `nano-banana-2`.
- **Temperature:** passes `disabledReason` to `TemperatureControl`, and sends `temperature` only when the model accepts it.
- **Generate button:** when the selected model cannot take the current images, the button is disabled and `ImageModelIssue` is shown. The model is never switched automatically.
- **Collage call:** calls `generateCollage` with the options object, which fixes the misaligned arguments.
- **Cost:** estimates from the selected model's price at each ratio's resolution, and shows "—" when the price is unknown.
- **Errors:**
  - reports errors to the panel, including which image of the batch failed.
  - shows the Google key screen only for a Google 403 / PERMISSION_DENIED, as before.
  - mounts `<ErrorPanel />` once.
- **Key leak:** removes the `process.env.API_KEY` check from the browser.

```diff
diff --git a/App.tsx b/App.tsx
index cb1352d..bb7ce81 100644
--- a/App.tsx
+++ b/App.tsx
@@ -9,6 +9,21 @@ import { AutopilotStudio } from './components/AutopilotStudio';
 import { PWAInstallPrompt } from './components/PWAInstallPrompt';
 import { TemperatureControl } from './components/TemperatureControl';
 import { generateCollage, fileToBase64, compressToLimit } from './services/geminiService';
+import { ErrorPanel } from './components/ErrorPanel';
+import { ImageModelIssue, ImageModelSelector } from './components/ImageModelSelector';
+import { findImageModel, useImageModels } from './components/useImageModels';
+import { ImageRequestError } from './services/imageApi';
+import { reportError } from './services/errorReporter';
+import {
+  DEFAULT_IMAGE_MODEL_ID,
+  TEMPERATURE_SUPPORT_NOTE,
+  USD_TO_HKD,
+  estimateCostUsd,
+  estimateInputTokens,
+  modelIssue,
+  type ImageModelView,
+} from './shared/imageModels';
+import { outputSpec } from './shared/imageOutput';
 import { UsageService, MonthlyUsageData, UsageHistory } from './services/usageService';
 import { HistoryService } from './services/historyService';
 import { auth, signInWithGoogle, signOut } from './services/firebaseService';
@@ -177,8 +192,12 @@ const HistoryModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOp
 
 interface UsageMeterProps {
   refreshTrigger: number;
-  selectedModel: 'nano-banana-pro' | 'nano-banana-2';
-  setSelectedModel: (model: 'nano-banana-pro' | 'nano-banana-2') => void;
+  selectedModel: string;
+  setSelectedModel: (model: string) => void;
+  imageModels: readonly ImageModelView[];
+  imageModelsLoading: boolean;
+  /** Reference images the current studio will send; incompatible models are disabled. */
+  referenceCount: number;
   user: User | null;
   onLogout: () => void;
   currentView: 'manual' | 'autopilot';
@@ -198,7 +217,10 @@ const UsageMeter: React.FC<UsageMeterProps> = ({
   setCurrentView,
   isManualStudioHighlighted,
   setIsManualStudioHighlighted,
-  onOpenPWAInstall
+  onOpenPWAInstall,
+  imageModels,
+  imageModelsLoading,
+  referenceCount
 }) => {
     const [stats, setStats] = useState<MonthlyUsageData | null>(null);
     const [showHistory, setShowHistory] = useState(false);
@@ -235,6 +257,7 @@ const UsageMeter: React.FC<UsageMeterProps> = ({
                             <span className="text-gray-800">|</span>
                             <span title="Estimated Cost">
                                 <span className="text-gray-500 font-bold">Cost:</span> <span className="font-bold text-yellow-400">{UsageService.formatHKD(stats.totalCostHKD)}</span>
+                                {stats.unpricedImages ? <span className="text-gray-500" title="未有單價的模型生成的圖片，未計入費用"> (+{stats.unpricedImages} 張未計價)</span> : null}
                             </span>
                             <button 
                                 onClick={() => setShowHistory(true)}
@@ -294,14 +317,14 @@ const UsageMeter: React.FC<UsageMeterProps> = ({
                         {/* Service Model Selectors (Pull Down Menu) */}
                         <div className="flex items-center gap-1.5 bg-gray-950 px-2 py-1 rounded-lg border border-gray-800 shrink-0">
                             <span className="text-gray-400 text-[11px] font-extrabold px-0.5 hidden lg:inline">Model:</span>
-                            <select
+                            <ImageModelSelector
+                                models={imageModels}
+                                loading={imageModelsLoading}
                                 value={selectedModel}
-                                onChange={(e) => setSelectedModel(e.target.value as 'nano-banana-pro' | 'nano-banana-2')}
-                                className="bg-gray-900 text-white text-xs font-bold py-0.5 px-2 rounded border border-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
-                            >
-                                <option value="nano-banana-pro">Pro 思考 (nano-banana-pro)</option>
-                                <option value="nano-banana-2">2代平衡 (nano-banana-2)</option>
-                            </select>
+                                onChange={setSelectedModel}
+                                referenceCount={referenceCount}
+                                className="bg-gray-900 text-white text-xs font-bold py-0.5 px-2 rounded border border-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer max-w-[16rem]"
+                            />
                         </div>
                         
                         {user && (
@@ -386,11 +409,6 @@ const AppContent: React.FC = () => {
   }, [prompt]);
   
   const [selectedRatios, setSelectedRatios] = useState<AspectRatio[]>(['16:9']);
-  const selectedQuality = useMemo<ImageQuality>(() => {
-    const currentRatio = selectedRatios[0] || '16:9';
-    const opt = RATIO_OPTIONS.find(o => o.value === currentRatio);
-    return opt ? opt.quality : '1K';
-  }, [selectedRatios]);
   const [selectedCount, setSelectedCount] = useState<1 | 2 | 3>(1);
   const [strictFidelity, setStrictFidelity] = useState<boolean>(false);
   const [preserveBackground, setPreserveBackground] = useState<boolean>(false);
@@ -417,7 +435,15 @@ const AppContent: React.FC = () => {
     }
   }, [temperature]);
 
-  const [selectedModel, setSelectedModel] = useState<'nano-banana-pro' | 'nano-banana-2'>('nano-banana-2');
+  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
+  const { models: imageModels, loading: imageModelsLoading } = useImageModels();
+  const currentImageModel = findImageModel(imageModels, selectedModel);
+  const [autopilotReferenceCount, setAutopilotReferenceCount] = useState(0);
+  // Unknown ids (for example a removed model restored from a saved draft) go back to the default.
+  useEffect(() => {
+    if (!imageModelsLoading && imageModels.length > 0 && !currentImageModel) setSelectedModel(DEFAULT_IMAGE_MODEL_ID);
+  }, [imageModelsLoading, imageModels, currentImageModel]);
+  const temperatureDisabledReason = currentImageModel && !currentImageModel.temperature ? TEMPERATURE_SUPPORT_NOTE : null;
   
   const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
   const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
@@ -479,12 +505,7 @@ const AppContent: React.FC = () => {
             const data = await resp.json().catch(() => ({}));
             setHasApiKey(!!data.hasApiKey);
           } else {
-            // Fallback to define env check
-            try {
-              setHasApiKey(!!process.env.API_KEY);
-            } catch (e) {
-              setHasApiKey(false);
-            }
+            setHasApiKey(false);
           }
         }
       } catch (e) {
@@ -645,10 +666,14 @@ const AppContent: React.FC = () => {
     }));
   };
 
-  const handleApiError = (error: any) => {
+  const handleApiError = (error: any, context: Record<string, string | number | undefined> = {}) => {
     console.error("API Error:", error);
+    reportError(error, 'collage', context);
     const msg = error?.message || '';
-    if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('Requested entity was not found')) {
+    const details = error instanceof ImageRequestError ? error.details : {};
+    // Same trigger as before the migration (403 / PERMISSION_DENIED), now limited to Google errors.
+    const keyPermissionProblem = details.status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('Requested entity was not found');
+    if (keyPermissionProblem && (details.provider === 'google' || !details.provider)) {
        showToast("授權失敗。請選擇具有啟用計費功能 (Billing Enabled) 的 Google Cloud Project 專案 API 密鑰。", "error");
        setHasApiKey(false); 
     } else {
@@ -656,41 +681,20 @@ const AppContent: React.FC = () => {
     }
   };
 
-  const activeRatio = selectedRatios[0] || '16:9';
-  const activeOption = RATIO_OPTIONS.find(o => o.value === activeRatio);
-  const activeQuality = activeOption ? activeOption.quality : '1K';
+  const manualReferenceCount = selectedTemplateIds.length + sources.length;
+  const activeReferenceCount = currentView === 'manual' ? manualReferenceCount : autopilotReferenceCount;
+  const manualModelIssue = currentImageModel ? modelIssue(currentImageModel, manualReferenceCount) : null;
 
   const estimatedCost = useMemo(() => {
-    const INPUT_IMAGE_TOKENS = 258;
-    const INPUT_TEXT_TOKEN_RATIO = 0.25; 
-    const PRICE_PER_1M_INPUT_TOKENS_USD = 5.00; 
-    
-    // Dynamic output image price based on model and selected ratio quality
-    let PRICE_PER_OUTPUT_IMAGE_USD = 0.134;
-    if (selectedModel === 'nano-banana-2-lite') {
-      PRICE_PER_OUTPUT_IMAGE_USD = activeQuality === '1K' ? 0.034 : 0.050;
-    } else if (selectedModel === 'nano-banana-2') {
-      PRICE_PER_OUTPUT_IMAGE_USD = activeQuality === '1K' ? 0.067 : 0.101;
-    } else {
-      PRICE_PER_OUTPUT_IMAGE_USD = 0.134;
-    }
-    
-    const HKD_EXCHANGE_RATE = 7.8;
-    const numInputImages = selectedTemplateIds.length + sources.length;
-    const inputImageTokens = numInputImages * INPUT_IMAGE_TOKENS;
-    const inputTextTokens = prompt.length * INPUT_TEXT_TOKEN_RATIO;
-    const totalInputTokens = inputImageTokens + inputTextTokens;
-    const numOutputImages = selectedRatios.length * selectedCount;
-    const inputCostUSD = (totalInputTokens / 1000000) * PRICE_PER_1M_INPUT_TOKENS_USD;
-    const outputCostUSD = numOutputImages * PRICE_PER_OUTPUT_IMAGE_USD;
-    const totalUSD = inputCostUSD + outputCostUSD;
-    const totalHKD = totalUSD * HKD_EXCHANGE_RATE;
+    const plannedRatios = selectedRatios.flatMap((ratio) => Array.from({ length: selectedCount }, () => ratio));
+    const inputTokens = estimateInputTokens(manualReferenceCount, prompt.length);
+    const totalUSD = estimateCostUsd(currentImageModel, { inputImages: manualReferenceCount, promptChars: prompt.length, ratios: plannedRatios });
     return {
-        totalHKD: totalHKD.toFixed(2),
-        inputTokens: Math.ceil(totalInputTokens),
-        outputCount: numOutputImages
+        totalHKD: totalUSD === null ? null : (totalUSD * USD_TO_HKD).toFixed(2),
+        inputTokens,
+        outputCount: plannedRatios.length
     };
-  }, [templates, selectedTemplateIds, sources, prompt, selectedRatios, selectedCount, selectedModel, activeQuality]);
+  }, [manualReferenceCount, prompt, selectedRatios, selectedCount, currentImageModel]);
 
   const manualCancelRef = useRef<boolean>(false);
 
@@ -713,6 +717,14 @@ const AppContent: React.FC = () => {
         showToast("請選擇至少一種圖片比例比例。", "warning");
         return;
     }
+    if (!currentImageModel) {
+        showToast("圖片模型清單尚未載入，請稍後再試。", "warning");
+        return;
+    }
+    if (manualModelIssue) {
+        showToast(`目前模型「${currentImageModel.label}」${manualModelIssue}。`, "warning");
+        return;
+    }
     setIsGenerating(true);
     setGeneratingStatus('Preparing assets...');
     try {
@@ -722,9 +734,9 @@ const AppContent: React.FC = () => {
       
       if (manualCancelRef.current) return;
 
-      // Calculate tokens per single request for usage tracking
+      // Estimated tokens per single request for usage tracking
       const totalInputImages = selectedTemplates.length + sources.length;
-      const estimatedInputTokensPerReq = UsageService.calculateEstimatedTokens(totalInputImages, prompt.length);
+      const estimatedInputTokensPerReq = estimateInputTokens(totalInputImages, prompt.length);
 
       const tasks = [];
       for (const ratio of selectedRatios) {
@@ -741,22 +753,21 @@ const AppContent: React.FC = () => {
         const task = tasks[i];
         setGeneratingStatus(`Generating image ${i + 1} of ${tasks.length} (${task.ratio})...`);
         try {
-            let base64Image = await generateCollage(
-                templateB64s,
-                sourcesB64,
+            let base64Image = await generateCollage({
+                templateAssets: templateB64s,
+                sourceAssets: sourcesB64,
                 prompt,
-                task.ratio,
-                selectedQuality,
+                ratio: task.ratio,
                 strictFidelity,
                 preserveBackground,
                 removeBackground,
                 copyLogo,
                 prohibitLogo,
                 eraseText,
-                titles,
+                titleConfig: titles,
                 selectedModel,
-                temperature
-            );
+                temperature: currentImageModel.temperature ? temperature : undefined,
+            });
 
             if (manualCancelRef.current) {
               showToast('已取消生成工作', 'info');
@@ -769,9 +780,11 @@ const AppContent: React.FC = () => {
             }
 
             // Track Usage on Success
-            const activeOpt = RATIO_OPTIONS.find(o => o.value === task.ratio);
-            const activeQual = activeOpt ? activeOpt.quality : '1K';
-            UsageService.trackTransaction(estimatedInputTokensPerReq, 1, selectedModel, activeQual);
+            UsageService.trackTransaction(
+                estimatedInputTokensPerReq,
+                1,
+                estimateCostUsd(currentImageModel, { inputImages: totalInputImages, promptChars: prompt.length, ratios: [task.ratio] }),
+            );
             setUsageUpdateTrigger(prev => prev + 1);
 
             const newImage: GeneratedImage = {
@@ -783,7 +796,7 @@ const AppContent: React.FC = () => {
             setGeneratedImages(prev => [newImage, ...prev]);
         } catch (err) {
             if (!manualCancelRef.current) {
-              handleApiError(err);
+              handleApiError(err, { 批次: `第 ${i + 1}/${tasks.length} 張 (${task.ratio})`, 解像度: outputSpec(task.ratio).resolution });
             }
             break;
         }
@@ -1102,11 +1115,15 @@ const AppContent: React.FC = () => {
 
   return (
     <div className="min-h-screen bg-gray-50 flex flex-col notranslate">
+      <ErrorPanel />
       {/* Top Usage Meter with model controls and logout */}
       <UsageMeter 
         refreshTrigger={usageUpdateTrigger} 
         selectedModel={selectedModel}
         setSelectedModel={setSelectedModel}
+        imageModels={imageModels}
+        imageModelsLoading={imageModelsLoading}
+        referenceCount={activeReferenceCount}
         user={currentUser}
         onLogout={handleLogout}
         currentView={currentView}
@@ -1141,6 +1158,8 @@ const AppContent: React.FC = () => {
           onOpenPWAInstall={() => setForceOpenPWAModal(true)}
           imageModel={selectedModel}
           setImageModel={setSelectedModel}
+          imageModels={imageModels}
+          onReferenceCountChange={setAutopilotReferenceCount}
         />
       ) : (
         <div className="flex flex-col md:flex-row flex-1">
@@ -1353,6 +1372,7 @@ const AppContent: React.FC = () => {
                         temperature={temperature}
                         onChange={setTemperature}
                         compact
+                        disabledReason={temperatureDisabledReason}
                     />
 
                     <div>
@@ -1387,17 +1407,19 @@ const AppContent: React.FC = () => {
                 </div>
                 <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                     <span className="text-gray-800 font-bold">Total (HKD):</span>
-                    <span className="font-mono text-red-600 font-bold text-sm">HK${estimatedCost.totalHKD}</span>
+                    <span className="font-mono text-red-600 font-bold text-sm">{estimatedCost.totalHKD === null ? '—' : `HK$${estimatedCost.totalHKD}`}</span>
                 </div>
                 <p className="text-[10px] text-gray-400 mt-1 italic text-right">
-                    *Estimate: ${selectedModel === 'nano-banana-2-lite' ? (activeQuality === '1K' ? '0.034' : '0.050') : (selectedModel === 'nano-banana-2' ? (activeQuality === '1K' ? '0.067' : '0.101') : '0.134')} USD/image ({selectedModel === 'nano-banana-2-lite' ? 'Lite簡易快速' : (selectedModel === 'nano-banana-2' ? '2代平衡' : 'Pro思考')} - {activeQuality})
+                    {currentImageModel?.price
+                      ? `*Estimate: ${currentImageModel.label}，每張 1K $${currentImageModel.price.perImageUsd['1K']} / 2K $${currentImageModel.price.perImageUsd['2K']} USD`
+                      : `*${currentImageModel?.label ?? '此模型'} 未有已核實的單價，預估以「—」表示`}
                 </p>
             </div>
 
             <div className="flex gap-3 sticky bottom-0 bg-white pt-4 pb-2 border-t border-gray-100">
                 <button 
                     onClick={startCollage}
-                    disabled={isGenerating}
+                    disabled={isGenerating || !currentImageModel || manualModelIssue !== null}
                     className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                 >
                     {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <ImageIcon size={20} />}
@@ -1418,6 +1440,7 @@ const AppContent: React.FC = () => {
                     </button>
                 )}
             </div>
+            <ImageModelIssue model={currentImageModel} referenceCount={manualReferenceCount} />
             {isGenerating && <p className="text-xs text-center text-gray-500 mt-2"><span key={generatingStatus} className="notranslate">{generatingStatus}</span></p>}
           </div>
 
@@ -1529,6 +1552,7 @@ const AppContent: React.FC = () => {
                 onClose={() => setEditorOpen(false)}
                 onUpdateImage={updateEditedImage}
                 selectedModel={selectedModel}
+                modelView={currentImageModel}
             />
           )}
 
```


## Step 13: `components/AutopilotStudio.tsx`

Apply this diff. It:
- **Props:** takes `imageModels` and `onReferenceCountChange`, and reports how many reference images the next run will send. In semi mode that is the templates plus the sources. In full mode it is the templates only.
- **Before a run:** blocks both run buttons and shows `ImageModelIssue` when the selected model cannot take them.
- **Page images in full mode:** keeps only as many extracted page images as the model still accepts, up to the existing 5, and says so in a toast. These images come from the article page, not from the user, and the server already kept only 5.
- **Generation:** calls `generateCollage` with the options object, sending `temperature` only to models that accept it, and estimates each image's cost.
- **Errors:** reports errors to the panel for collage, title generation, article fetching and page-image extraction. The existing toasts stay.

```diff
diff --git a/components/AutopilotStudio.tsx b/components/AutopilotStudio.tsx
index a5d324e..213b03a 100644
--- a/components/AutopilotStudio.tsx
+++ b/components/AutopilotStudio.tsx
@@ -57,6 +57,16 @@ import {
 import { UsageService } from '../services/usageService';
 import { asyncStorage, compressDataUrlIfNeeded } from '../utils/storage';
 import { TemperatureControl } from './TemperatureControl';
+import { ImageModelIssue } from './ImageModelSelector';
+import { findImageModel } from './useImageModels';
+import { reportError, type ErrorOperation } from '../services/errorReporter';
+import {
+  TEMPERATURE_SUPPORT_NOTE,
+  estimateCostUsd,
+  modelIssue,
+  remainingReferenceCapacity,
+  type ImageModelView,
+} from '../shared/imageModels';
 
 const RATIO_OPTIONS: { label: string; value: AspectRatio; desc: string }[] = [
   { label: '16:9 (OG 圖）', value: '16:9', desc: '1200 x 675 px' },
@@ -128,8 +138,12 @@ interface AutopilotStudioProps {
   onNavigateToManual?: () => void;
   setIsManualStudioHighlighted?: (val: boolean) => void;
   onOpenPWAInstall?: () => void;
-  imageModel?: 'nano-banana-pro' | 'nano-banana-2';
-  setImageModel?: (model: 'nano-banana-pro' | 'nano-banana-2') => void;
+  imageModel?: string;
+  setImageModel?: (model: string) => void;
+  /** From GET /api/image-models (loaded once by App). */
+  imageModels?: readonly ImageModelView[];
+  /** Reports the reference images the next run will send, so the top-bar selector can disable models. */
+  onReferenceCountChange?: (count: number) => void;
 }
 
 export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
@@ -145,16 +159,20 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
   setIsManualStudioHighlighted,
   onOpenPWAInstall,
   imageModel: propImageModel,
-  setImageModel: propSetImageModel
+  setImageModel: propSetImageModel,
+  imageModels = [],
+  onReferenceCountChange
 }) => {
   // Autopilot Mode: 'semi' | 'full'
   const [autopilotMode, setAutopilotMode] = useState<'semi' | 'full'>('semi');
 
   // Model Selections
   const [textModel, setTextModel] = useState<'gemini-3.8-flash' | 'gemini-3.5-flash-lite'>('gemini-3.8-flash');
-  const [internalImageModel, setInternalImageModel] = useState<'nano-banana-pro' | 'nano-banana-2'>('nano-banana-2');
+  const [internalImageModel, setInternalImageModel] = useState<string>('nano-banana-2');
   const imageModel = propImageModel ?? internalImageModel;
   const setImageModel = propSetImageModel ?? setInternalImageModel;
+  const currentImageModel = findImageModel(imageModels, imageModel);
+  const temperatureDisabledReason = currentImageModel && !currentImageModel.temperature ? TEMPERATURE_SUPPORT_NOTE : null;
 
   // Article Inputs
   const [articleUrl, setArticleUrl] = useState('');
@@ -748,6 +766,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       showToast(`成功獲取文章內容 (${res.content.length} 字)，並同步啟動自動撈取素材圖片！`, 'success');
       await extractTask;
     } catch (e: any) {
+      reportError(e, 'article');
       showToast(e.message || '無法抓取網址，請確認網址或直接貼上內文', 'error');
     } finally {
       setIsFetchingUrl(false);
@@ -782,6 +801,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       showToast('成功生成 5 組爆款病毒標題！', 'success');
     } catch (e: any) {
       if (!cancelRef.current) {
+        reportError(e, 'titles');
         showToast(e.message || '生成標題失敗，請稍後再試', 'error');
       }
     } finally {
@@ -938,6 +958,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
     } catch (e: any) {
       if (!cancelRef.current) {
         setNoSourceMode(true);
+        reportError(e, 'page-images');
         showToast(e.message || '抓取網頁圖片失敗，請確認網址或直接上載', 'error');
       }
     } finally {
@@ -945,6 +966,14 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
     }
   };
 
+  // Reference images the next run sends. Full autopilot: templates only (page images are capped to fit).
+  const plannedTemplateCount = selectedTemplateIds.length > 0 ? selectedTemplateIds.length : Math.min(templates.length, 1);
+  const plannedReferenceCount = autopilotMode === 'full' ? plannedTemplateCount : selectedTemplateIds.length + sources.length;
+  const currentModelIssue = currentImageModel ? modelIssue(currentImageModel, plannedReferenceCount) : null;
+  useEffect(() => {
+    onReferenceCountChange?.(plannedReferenceCount);
+  }, [plannedReferenceCount, onReferenceCountChange]);
+
   // Execute Semi-Autopilot Image Generation
   const handleExecuteSemiGeneration = async () => {
     cancelRef.current = false;
@@ -956,9 +985,15 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       showToast('請先選擇或輸入欲使用的標題組合', 'warning');
       return;
     }
+    const semiIssue = currentImageModel ? modelIssue(currentImageModel, selectedTemplateIds.length + sources.length) : '圖片模型清單尚未載入';
+    if (semiIssue) {
+      showToast(`目前圖片模型無法使用：${semiIssue}`, 'warning');
+      return;
+    }
 
     setIsProcessing(true);
     setStatusMessage('正在合成圖片...');
+    let attempt = '';
     try {
       const selectedTemplates = templates.filter(t => selectedTemplateIds.includes(t.id));
       const templateB64s = await Promise.all(selectedTemplates.map(t => fileToBase64(t.file)));
@@ -990,25 +1025,25 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
           break;
         }
         const ratio = selectedRatios[i];
+        attempt = `第 ${i + 1}/${selectedRatios.length} 張 (${ratio})`;
         setStatusMessage(`正在合成 ${ratio} 圖片 (${i + 1}/${selectedRatios.length})...`);
 
-        let base64Image = await generateCollage(
-          templateB64s,
-          sourceB64s,
-          getEffectiveGlobalPrompt(),
+        let base64Image = await generateCollage({
+          templateAssets: templateB64s,
+          sourceAssets: sourceB64s,
+          prompt: getEffectiveGlobalPrompt(),
           ratio,
-          '2K',
           strictFidelity,
-          false,
+          preserveBackground: false,
           removeBackground,
           copyLogo,
           prohibitLogo,
           prohibitPretrainedLogo,
           eraseText,
           titleConfig,
-          imageModel,
-          temperature
-        );
+          selectedModel: imageModel,
+          temperature: currentImageModel?.temperature ? temperature : undefined,
+        });
 
         if (cancelRef.current) {
           showToast('已取消生成工作', 'info');
@@ -1019,7 +1054,11 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
           base64Image = await compressToLimit(base64Image, 2 * 1024 * 1024);
         }
 
-        UsageService.trackTransaction(500, 1, imageModel, '2K');
+        UsageService.trackTransaction(
+          500,
+          1,
+          estimateCostUsd(currentImageModel, { inputImages: templateB64s.length + sourceB64s.length, promptChars: getEffectiveGlobalPrompt().length, ratios: [ratio] }),
+        );
         onUpdateUsage();
 
         const newImage: GeneratedImage = {
@@ -1036,6 +1075,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       }
     } catch (e: any) {
       if (!cancelRef.current) {
+        reportError(e, 'collage', { 批次: attempt || undefined });
         showToast(e.message || '生成圖片失敗', 'error');
       }
     } finally {
@@ -1055,10 +1095,17 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       showToast('全自動駕駛模式需要文章網址或文章內容', 'warning');
       return;
     }
+    const fullIssue = currentImageModel ? modelIssue(currentImageModel, plannedTemplateCount) : '圖片模型清單尚未載入';
+    if (fullIssue) {
+      showToast(`目前圖片模型無法使用：${fullIssue}`, 'warning');
+      return;
+    }
 
     setIsProcessing(true);
     let currentContent = articleContent;
     let currentSources = [...sources];
+    let failedOperation: ErrorOperation = 'article';
+    let attempt = '';
 
     try {
       // Step 1: Article Fetching & Concurrent Web Image Extraction
@@ -1111,11 +1158,15 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
                 console.error('Error converting extracted image:', err);
               }
             }
-            if (newFiles.length > 0) {
-              currentSources = newFiles;
-              setSources(newFiles);
-              setNoSourceMode(false);
+            // Page images are not user-provided: use only as many as the selected model still accepts.
+            const capacity = currentImageModel ? remainingReferenceCapacity(currentImageModel, plannedTemplateCount) : newFiles.length;
+            const usable = newFiles.slice(0, Math.min(newFiles.length, capacity));
+            if (usable.length < newFiles.length) {
+              showToast(`「${currentImageModel?.label}」最多 ${currentImageModel?.referenceLimit.max} 張參考圖，已有 ${plannedTemplateCount} 張樣板：只使用前 ${usable.length} 張網頁圖片。`, 'info');
             }
+            currentSources = usable;
+            setSources(usable);
+            if (usable.length > 0) setNoSourceMode(false);
           }
         } else {
           console.error('Extract web images error in full autopilot:', imageResult.reason);
@@ -1129,6 +1180,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       // Step 2: Title Generation
       if (cancelRef.current) return;
       setActiveStep(2);
+      failedOperation = 'titles';
       setStatusMessage('自動步驟 2/4: Gemini 深度理解文章並創作 5 組爆款標題...');
       const groups = await generateViralTitles(currentContent, textModel, {
         mainMax,
@@ -1157,6 +1209,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       // Step 4: Generate Image using active Style Templates & extracted/existing Source Images
       if (cancelRef.current) return;
       setActiveStep(4);
+      failedOperation = 'collage';
       
       const selectedTemplates = templates.filter(t => selectedTemplateIds.includes(t.id));
       const activeTemplates = selectedTemplates.length > 0 ? selectedTemplates : [templates[0]];
@@ -1190,25 +1243,25 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
           break;
         }
         const ratio = selectedRatios[i];
+        attempt = `第 ${i + 1}/${selectedRatios.length} 張 (${ratio})`;
         setStatusMessage(`自動步驟 4/4: 配合風格樣板合成 ${ratio} Open Graph 圖片 (${i + 1}/${selectedRatios.length})...`);
 
-        let base64Image = await generateCollage(
-          templateB64s,
-          sourceB64s,
-          getEffectiveGlobalPrompt(),
+        let base64Image = await generateCollage({
+          templateAssets: templateB64s,
+          sourceAssets: sourceB64s,
+          prompt: getEffectiveGlobalPrompt(),
           ratio,
-          '2K',
           strictFidelity,
-          false,
+          preserveBackground: false,
           removeBackground,
           copyLogo,
           prohibitLogo,
           prohibitPretrainedLogo,
           eraseText,
           titleConfig,
-          imageModel,
-          temperature
-        );
+          selectedModel: imageModel,
+          temperature: currentImageModel?.temperature ? temperature : undefined,
+        });
 
         if (cancelRef.current) {
           showToast('已取消生成工作', 'info');
@@ -1219,7 +1272,11 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
           base64Image = await compressToLimit(base64Image, 2 * 1024 * 1024);
         }
 
-        UsageService.trackTransaction(800, 1, imageModel, '2K');
+        UsageService.trackTransaction(
+          800,
+          1,
+          estimateCostUsd(currentImageModel, { inputImages: templateB64s.length + sourceB64s.length, promptChars: getEffectiveGlobalPrompt().length, ratios: [ratio] }),
+        );
         onUpdateUsage();
 
         const newImage: GeneratedImage = {
@@ -1236,6 +1293,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
       }
     } catch (e: any) {
       if (!cancelRef.current) {
+        reportError(e, failedOperation, { 模式: '全自動', 批次: failedOperation === 'collage' ? attempt || undefined : undefined });
         showToast(e.message || '全自動駕駛執行中途出錯，請檢查步驟', 'error');
       }
     } finally {
@@ -1915,6 +1973,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
               <TemperatureControl
                 temperature={temperature}
                 onChange={setTemperature}
+                disabledReason={temperatureDisabledReason}
               />
             </div>
           </div>
@@ -2246,7 +2305,8 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
             ) : autopilotMode === 'semi' ? (
               <button
                 onClick={handleExecuteSemiGeneration}
-                className="w-full bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white font-black py-3.5 px-6 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm tracking-wide cursor-pointer"
+                disabled={currentModelIssue !== null}
+                className="disabled:opacity-50 disabled:cursor-not-allowed w-full bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white font-black py-3.5 px-6 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm tracking-wide cursor-pointer"
               >
                 <ImageIcon size={18} />
                 <span>立刻生成新的 OG 圖片</span>
@@ -2256,7 +2316,8 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
                 <button
                   type="button"
                   onClick={handleExecuteFullAutopilot}
-                  className="flex-1 bg-gradient-to-r from-amber-500 via-sky-600 to-sky-700 hover:from-amber-600 hover:to-sky-800 text-white font-black py-3.5 sm:py-4 px-4 sm:px-6 rounded-xl transition-all shadow-xl flex items-center justify-center gap-2 text-xs sm:text-sm tracking-wide transform hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
+                  disabled={currentModelIssue !== null}
+                  className="disabled:opacity-50 disabled:cursor-not-allowed flex-1 bg-gradient-to-r from-amber-500 via-sky-600 to-sky-700 hover:from-amber-600 hover:to-sky-800 text-white font-black py-3.5 sm:py-4 px-4 sm:px-6 rounded-xl transition-all shadow-xl flex items-center justify-center gap-2 text-xs sm:text-sm tracking-wide transform hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                 >
                   <Zap size={18} className="text-amber-300 animate-bounce shrink-0" />
                   <span>🚀 一鍵全自動生成</span>
@@ -2264,7 +2325,8 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
                 <button
                   type="button"
                   onClick={handleExecuteSemiGeneration}
-                  className="bg-sky-900 hover:bg-sky-950 text-white font-black py-3.5 sm:py-4 px-4 sm:px-5 rounded-xl border border-sky-400/40 shadow-lg hover:border-amber-400/80 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm cursor-pointer shrink-0 active:scale-[0.99]"
+                  disabled={currentModelIssue !== null}
+                  className="disabled:opacity-50 disabled:cursor-not-allowed bg-sky-900 hover:bg-sky-950 text-white font-black py-3.5 sm:py-4 px-4 sm:px-5 rounded-xl border border-sky-400/40 shadow-lg hover:border-amber-400/80 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm cursor-pointer shrink-0 active:scale-[0.99]"
                   title="使用當前標題與素材重新合成 OG 圖片"
                 >
                   <RefreshCw size={16} className="text-amber-400 shrink-0" />
@@ -2272,6 +2334,7 @@ export const AutopilotStudio: React.FC<AutopilotStudioProps> = ({
                 </button>
               </div>
             )}
+            <ImageModelIssue model={currentImageModel} referenceCount={plannedReferenceCount} />
           </div>
 
           {/* Progress Indicator for Full Autopilot */}
```


## Step 14: `components/ImageEditor.tsx`

Apply this diff. It:
- calls `editImage` with the options object.
- sends the image's own `width:height`, so models that cannot keep the input aspect use the nearest ratio.
- keeps logo replacement at temperature 0.5 on models that accept temperature.
- reports errors to the panel.
- shows a one-line note when the selected model treats the mask only as a reference image. That applies to the GPT Image and Seedream models; the Nano Banana family handles masks as before.

```diff
diff --git a/components/ImageEditor.tsx b/components/ImageEditor.tsx
index f00cab3..0f2fbd9 100644
--- a/components/ImageEditor.tsx
+++ b/components/ImageEditor.tsx
@@ -6,12 +6,17 @@ import {
 } from 'lucide-react';
 import { GeneratedImage } from '../types';
 import { editImage } from '../services/geminiService';
+import { reportError } from '../services/errorReporter';
+import { MASK_REFERENCE_ONLY_NOTE, type ImageModelView } from '../shared/imageModels';
 
 interface ImageEditorProps {
   image: GeneratedImage;
   onClose: () => void;
   onUpdateImage: (newImageUrl: string) => void;
-  selectedModel?: 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-2-lite';
+  /** App image model id from GET /api/image-models. */
+  selectedModel?: string;
+  /** Catalogue view of selectedModel: temperature support and mask-editing note. */
+  modelView?: ImageModelView;
 }
 
 interface EditPoint {
@@ -41,7 +46,7 @@ const PROMPT_TEMPLATES = [
   "Make it look like a Oil Painting"
 ];
 
-const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage, selectedModel = 'nano-banana-pro' }) => {
+const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage, selectedModel = 'nano-banana-2', modelView }) => {
   const [mode, setMode] = useState<'view' | 'prompt' | 'mask' | 'multi-mask' | 'crop' | 'replace-logo'>('view');
   const [prompt, setPrompt] = useState('');
   const [isLoading, setIsLoading] = useState(false);
@@ -92,6 +97,11 @@ const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage
   // Refs
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const imageRef = useRef<HTMLImageElement>(null);
+  // "width:height" of the image being edited, so models that cannot keep the input aspect use the nearest ratio.
+  const sourceAspect = (): string | undefined => {
+    const img = imageRef.current;
+    return img && img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}:${img.naturalHeight}` : undefined;
+  };
   const [isDrawing, setIsDrawing] = useState(false);
 
   // Sync local state if parent image updates
@@ -602,15 +612,17 @@ const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage
 
     setIsLoading(true);
     try {
-      const newImageData = await editImage(
-        previewUrl,
-        maskData,
-        promptText,
-        false,
-        selectedModel as 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-2-lite',
-        0.5,
-        logoDataUrl
-      );
+      const newImageData = await editImage({
+        imageUrl: previewUrl,
+        maskBase64: maskData,
+        prompt: promptText,
+        isMultiMask: false,
+        selectedModel,
+        // Logo replacement keeps its lower temperature on models that accept temperature.
+        temperature: modelView?.temperature ? 0.5 : undefined,
+        extraImageBase64: logoDataUrl,
+        sourceAspect: sourceAspect(),
+      });
       setPreviewUrl(newImageData);
       setMode('view');
       if (canvasRef.current) {
@@ -619,6 +631,7 @@ const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage
       }
     } catch (e: any) {
       console.error(e);
+      reportError(e, 'edit', { 動作: '替換 Logo' });
       const msg = e.message || 'AI 處理超時或出錯';
       setEditorError(`AI 替換 Logo 失敗: ${msg}。您可以改用「⚡ 即時套用 Logo」直接進行高解析無損替換。`);
     } finally {
@@ -696,7 +709,14 @@ const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage
             finalPrompt = JSON.stringify(instructions);
         }
 
-        const newImageData = await editImage(previewUrl, maskData, finalPrompt, isMulti, selectedModel as 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-2-lite');
+        const newImageData = await editImage({
+            imageUrl: previewUrl,
+            maskBase64: maskData,
+            prompt: finalPrompt,
+            isMultiMask: isMulti,
+            selectedModel,
+            sourceAspect: sourceAspect(),
+        });
         setPreviewUrl(newImageData);
         
         // Reset Logic
@@ -722,6 +742,7 @@ const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage
 
     } catch (e: any) {
         console.error(e);
+        reportError(e, 'edit', { 動作: isMulti ? '多色遮罩編輯' : '遮罩／指令編輯' });
         const msg = e.message || 'Unknown error';
         setEditorError(`Failed to edit image: ${msg}`);
     } finally {
@@ -847,6 +868,11 @@ const ImageEditor: React.FC<ImageEditorProps> = ({ image, onClose, onUpdateImage
         </div>
       </div>
 
+      {modelView?.maskEditing === 'reference-only' && (
+        <div className="bg-gray-900 border-b border-gray-800 text-gray-400 px-6 py-1.5 text-[11px]">
+          {modelView.label}：{MASK_REFERENCE_ONLY_NOTE}
+        </div>
+      )}
       {editorError && (
         <div className="bg-red-950 border-b border-red-800 text-red-200 px-6 py-2.5 flex items-center justify-between gap-3 z-50">
           <div className="flex items-center gap-2 text-xs font-semibold">
```


## Step 15: final check

1. `npm run lint` passes.
2. `npm run build` passes. The `build` and `start` scripts are unchanged.
3. No browser file reads `process.env`. `vite.config.ts` has no `define` for keys.
4. No code from `@google/genai` runs in `/api/generate-collage` or `/api/edit-image`.
5. Reply with a summary of every file you created or changed.
