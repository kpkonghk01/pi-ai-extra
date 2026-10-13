# og-master migration, Part 2 of 4: model selection in the UI

Continue the same task. Part 1 is already applied, and its rules and edit format still apply.

This part makes the UI read its model list from the server:

- the model selector in the top bar replaces the three model buttons;
- the reference-image limits disable models that cannot take the current images;
- the temperature control is disabled for models without temperature;
- the cost estimate and usage tracking use the selected model's price;
- the image editor shows a note for models that read masks only as a reference.

Image requests themselves change in Part 3.

Image models now have **canonical IDs** of the form `provider:familyId`, for example `google:gemini-nano-banana-2.1`, `toapis:gpt-image-2` or `kie:nano-banana-2`. The default is `google:gemini-nano-banana-2.1` (Nano Banana 2.1, the same default as before).

## Step 1: `types.ts`

**Find** in `types.ts`:

```ts
export type ImageModelType = 'gemini-nano-banana-2.1' | 'nano-banana-2' | 'nano-banana-pro';
```

**Replace with:**

```ts
/** Canonical image model ID, `provider:familyId` (for example 'google:gemini-nano-banana-2.1'). */
export type ImageModelType = string;
```

## Step 2: create `shared/imageModels.ts`

The default model, the USD→HKD rate and the cost estimate, shared by the UI and the usage tracking.

**Create** `shared/imageModels.ts`:

```ts
import { estimateImageCostUsd, type ImageModelView } from '@hk01/pi-ai-extra-image-kit';
import { outputSpec } from './imageOutput';

/**
 * og-master's own image-model constants and cost estimate. Model views, limits and the other
 * helpers come from @hk01/pi-ai-extra-image-kit. Safe in the browser bundle.
 */

export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';
export const USD_TO_HKD = 7.8;

/**
 * Estimated USD for one request per entry of `ratios`, or null when the model's price is unknown.
 * Each output image is its own request, so input tokens are counted once per image.
 */
export function estimateCostUsd(
  model: ImageModelView | undefined,
  input: { inputImages: number; promptChars: number; ratios: readonly string[] },
): number | null {
  if (!model?.price) return null;
  let total = 0;
  for (const ratio of input.ratios) {
    const cost = estimateImageCostUsd(model, {
      resolution: outputSpec(ratio).resolution,
      inputImages: input.inputImages,
      promptChars: input.promptChars,
    });
    if (cost === null) return null;
    total += cost;
  }
  return total;
}
```

## Step 3: replace `services/usageService.ts`

The old file had its own price table: a flat $5 per 1M input tokens and per-image prices for the three Google models. The prices now come from `server/imageModels.ts`. A model without a verified price is not added to the cost totals; it is counted as 「未計價」 instead.

**Replace the whole file** `services/usageService.ts`:

```ts
import { USD_TO_HKD } from '../shared/imageModels';

export interface MonthlyUsageData {
  inputTokens: number;
  outputImages: number;
  totalCostUSD: number;
  totalCostHKD: number;
  requestCount: number;
  lastUpdated: number;
  /** Images from models without a verified price; not included in the cost totals. */
  unpricedImages?: number;
}

export interface UsageHistory {
  [yearMonth: string]: MonthlyUsageData;
}

const STORAGE_KEY = 'og_collage_usage_history';

// Estimates only: prices come from GET /api/image-models (see shared/imageModels.ts estimateCostUsd).

export const UsageService = {
  // Get the current YYYY-MM string (e.g., "2023-10")
  getCurrentMonthKey: (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  // Load entire history
  getHistory: (): UsageHistory => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error("Failed to load usage history", e);
      return {};
    }
  },

  // Get specific month data, init if not exists
  getMonthData: (yearMonth: string): MonthlyUsageData => {
    const history = UsageService.getHistory();
    if (!history[yearMonth]) {
      return {
        inputTokens: 0,
        outputImages: 0,
        totalCostUSD: 0,
        totalCostHKD: 0,
        requestCount: 0,
        lastUpdated: Date.now()
      };
    }
    return history[yearMonth];
  },

  // Record an estimated transaction. costUsd is null when the model's price is unknown (未計價).
  trackTransaction: (inputTokens: number, outputImages: number, costUsd: number | null) => {
    const history = UsageService.getHistory();
    const currentKey = UsageService.getCurrentMonthKey();
    const current = history[currentKey] ?? UsageService.getMonthData(currentKey);
    const txCostUSD = costUsd ?? 0;
    const updated: MonthlyUsageData = {
      ...current,
      inputTokens: current.inputTokens + inputTokens,
      outputImages: current.outputImages + outputImages,
      totalCostUSD: current.totalCostUSD + txCostUSD,
      totalCostHKD: current.totalCostHKD + txCostUSD * USD_TO_HKD,
      requestCount: current.requestCount + 1,
      lastUpdated: Date.now(),
      unpricedImages: (current.unpricedImages ?? 0) + (costUsd === null ? outputImages : 0),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...history, [currentKey]: updated }));
    } catch (e) {
      console.error("Failed to save usage history", e);
    }
  },

  // Helper to format currency
  formatHKD: (amount: number): string => {
    return new Intl.NumberFormat('en-HK', {
      style: 'currency',
      currency: 'HKD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  },

  // Helper to calculate tokens for a standard request (used in App.tsx estimation)
  calculateEstimatedTokens: (numImages: number, textLength: number): number => {
      const INPUT_IMAGE_TOKENS = 258;
      const INPUT_TEXT_TOKEN_RATIO = 0.25;
      return Math.ceil((numImages * INPUT_IMAGE_TOKENS) + (textLength * INPUT_TEXT_TOKEN_RATIO));
  }
};
```

## Step 4: imports in `App.tsx`

**Find** in `App.tsx`:

```ts
import { UsageService, MonthlyUsageData, UsageHistory } from './services/usageService';
```

**Replace with:**

```ts
import { UsageService, MonthlyUsageData, UsageHistory } from './services/usageService';
import { DEFAULT_IMAGE_MODEL_ID, USD_TO_HKD, estimateCostUsd } from './shared/imageModels';
import { TEMPERATURE_SUPPORT_NOTE, estimateInputTokens, modelIssue } from '@hk01/pi-ai-extra-image-kit';
import { ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
```

## Step 5: the billing history shows unpriced images

**Find** in `App.tsx`:

```ts
                                        <div className="mt-2 text-[10px] text-gray-400 text-right">
                                            Last Updated: {new Date(data.lastUpdated).toLocaleString()}
                                        </div>
```

**Replace with:**

```ts
                                        {(data.unpricedImages ?? 0) > 0 && (
                                            <div className="mt-2 text-[10px] text-amber-600">
                                                另有 {data.unpricedImages} 張圖片的模型未有單價（未計價），不計入金額。
                                            </div>
                                        )}
                                        <div className="mt-2 text-[10px] text-gray-400 text-right">
                                            Last Updated: {new Date(data.lastUpdated).toLocaleString()}
                                        </div>
```

## Step 6: the model selector in the top bar

`UsageMeter` receives the selector as a prop instead of drawing three buttons.

**Find** in `App.tsx`:

```ts
interface UsageMeterProps {
  refreshTrigger: number;
  selectedModel: ImageModelType;
  setSelectedModel: (model: ImageModelType) => void;
  user: User | null;
  onLogout: () => void;
}

const UsageMeter: React.FC<UsageMeterProps> = ({ 
  refreshTrigger, 
  selectedModel, 
  setSelectedModel,
  user,
  onLogout
}) => {
```

**Replace with:**

```ts
interface UsageMeterProps {
  refreshTrigger: number;
  /** The image model selector, shown where the model buttons used to be. */
  modelSelector: ReactNode;
  user: User | null;
  onLogout: () => void;
}

const UsageMeter: React.FC<UsageMeterProps> = ({
  refreshTrigger,
  modelSelector,
  user,
  onLogout
}) => {
```

Replace everything from the comment `{/* Service Model Pill Selectors */}` through the `</div>` that closes the three buttons:

**Replace from** `App.tsx`:

```ts
                {/* Service Model Pill Selectors */}
```

**through:**

```ts
                        <span>Pro思考</span>
                    </button>
                </div>
```

**Replace with:**

```ts
                {/* Image model selector (grouped by provider; disabled options show the reason) */}
                <div className="flex items-center gap-1.5 bg-gray-950 p-1 rounded-lg border border-gray-800 shrink-0">
                    <span className="text-gray-500 text-[10px] uppercase font-extrabold px-1.5 hidden lg:inline">Model:</span>
                    {modelSelector}
                </div>
```

## Step 7: the selected model and the model list

`useImageModels('collage')` loads the collage route's model list once. `imageModelNeeds` is what one collage sends: the selected style templates and every source image.

**Find** in `App.tsx`:

```ts
  const [selectedModel, setSelectedModel] = useState<ImageModelType>('gemini-nano-banana-2.1');
```

**Replace with:**

```ts
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);

  // --- Image models (server catalogue policy; the collage route's scope) ---
  const {
    models: imageModels,
    loading: imageModelsLoading,
    failed: imageModelsFailed,
    reload: reloadImageModels,
  } = useImageModels('collage');
  const currentImageModel = findImageModel(imageModels, selectedModel);
  // Reference images one collage sends: the selected style templates + every source image.
  const imageModelNeeds = { referenceCount: selectedTemplateIds.length + sources.length };
  // Generation waits for the model list and is blocked while the selected model cannot take the request.
  const imageModelBlocked = !currentImageModel || modelIssue(currentImageModel, imageModelNeeds) !== null;
  // Only some models accept temperature; the slider keeps its value while it is disabled.
  const temperatureSupported = currentImageModel ? !!currentImageModel.temperature : true;
```

**Find** in `App.tsx`:

```ts
      <UsageMeter 
        refreshTrigger={usageUpdateTrigger} 
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        user={currentUser}
        onLogout={handleLogout}
      />
```

**Replace with:**

```ts
      <UsageMeter
        refreshTrigger={usageUpdateTrigger}
        modelSelector={
          <ImageModelSelector
            models={imageModels}
            loading={imageModelsLoading}
            failed={imageModelsFailed}
            onReload={reloadImageModels}
            value={selectedModel}
            onChange={setSelectedModel}
            defaultModelId={DEFAULT_IMAGE_MODEL_ID}
            needs={imageModelNeeds}
            className="max-w-[16rem] bg-gray-900 text-white text-[11px] font-bold rounded-md border border-gray-700 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-600"
            optionClassName="bg-gray-900 text-white"
          />
        }
        user={currentUser}
        onLogout={handleLogout}
      />
```

The selector groups the models by provider. A model without a server key, or with a lower reference-image limit than the current images need, is shown disabled with the reason. If the list fails to load, the selector becomes a 「模型清單載入失敗，按此重試」 button.

## Step 8: cost estimate

**Replace from** `App.tsx`:

```ts
  const estimatedCost = useMemo(() => {
```

**through:**

```ts
  }, [templates, selectedTemplateIds, sources, prompt, selectedRatios, selectedCount, selectedModel, activeQuality]);
```

**Replace with:**

```ts
  const estimatedCost = useMemo(() => {
    const numInputImages = selectedTemplateIds.length + sources.length;
    const plannedRatios = selectedRatios.flatMap((ratio) => Array.from({ length: selectedCount }, () => ratio));
    // The selected model's price at the resolution of each ratio; null when no price is verified.
    const totalUSD = estimateCostUsd(currentImageModel, { inputImages: numInputImages, promptChars: prompt.length, ratios: plannedRatios });
    return {
        totalHKD: totalUSD === null ? null : (totalUSD * USD_TO_HKD).toFixed(2),
        inputTokens: estimateInputTokens(numInputImages, prompt.length),
        outputCount: plannedRatios.length
    };
  }, [selectedTemplateIds, sources, prompt, selectedRatios, selectedCount, currentImageModel]);
```

**Find** in `App.tsx`:

```ts
                    <span className="font-mono text-red-600 font-bold text-sm">HK${estimatedCost.totalHKD}</span>
```

**Replace with:**

```ts
                    <span className="font-mono text-red-600 font-bold text-sm">{estimatedCost.totalHKD === null ? '—' : `HK$${estimatedCost.totalHKD}`}</span>
```

**Find** in `App.tsx`:

```ts
                    *Estimate: ${selectedModel === 'nano-banana-pro' ? '0.134' : (activeQuality === '1K' ? '0.067' : '0.101')} USD/image ({selectedModel === 'gemini-nano-banana-2.1' ? 'Nano Banana 2.1' : (selectedModel === 'nano-banana-2' ? '2代平衡' : 'Pro思考')} - {activeQuality})
```

**Replace with:**

```ts
                    *Estimate: {currentImageModel?.price?.perImageUsd[activeQuality] !== undefined ? `$${currentImageModel.price.perImageUsd[activeQuality]} USD/image` : '單價未知（未計價）'} ({currentImageModel?.label ?? selectedModel} - {activeQuality})
```

## Step 9: usage tracking after a successful collage

**Find** in `App.tsx`:

```ts
            // Track Usage on Success
            const activeOpt = RATIO_OPTIONS.find(o => o.value === task.ratio);
            const activeQual = activeOpt ? activeOpt.quality : '1K';
            UsageService.trackTransaction(estimatedInputTokensPerReq, 1, selectedModel, activeQual);
```

**Replace with:**

```ts
            // Track usage on success: the estimated cost at the resolution actually requested (null = 未計價)
            const costUsd = estimateCostUsd(currentImageModel, { inputImages: totalInputImages, promptChars: effectivePrompt.length, ratios: [task.ratio] });
            UsageService.trackTransaction(estimatedInputTokensPerReq, 1, costUsd);
```

## Step 10: AI 忠實程度 (temperature)

Only the Google models accept temperature. For any other model, disable the slider and its three buttons, keep the stored value, and say why. A `<fieldset disabled>` disables every control inside it.

**Find** in `App.tsx`:

```ts
                  {/* Range Input Control */}
                  <div className="px-1 py-1">
```

**Replace with:**

```ts
                  {!temperatureSupported && (
                    <p className="text-[11px] text-gray-500 mb-1">{TEMPERATURE_SUPPORT_NOTE}</p>
                  )}
                  {/* Range Input Control (disabled for models without temperature; the value is kept) */}
                  <fieldset disabled={!temperatureSupported} className={`px-1 py-1 ${!temperatureSupported ? 'opacity-50' : ''}`}>
```

Close the `fieldset` where the range control's `div` used to close, right after the 創意 button:

**Find** in `App.tsx`:

```ts
                        創意
                      </button>
                    </div>
                  </div>
```

**Replace with:**

```ts
                        創意
                      </button>
                    </div>
                  </fieldset>
```

## Step 11: the 開始拼貼 button

Disable it until the model list has loaded and while the selected model cannot take the request (missing key, too many reference images), and show the reason above it. The app never switches to another model by itself and never drops images.

**Find** in `App.tsx`:

```ts
            {/* Pinned Floating Generate Button Footer */}
            <div className="shrink-0 p-4 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-[0_-6px_20px_rgba(0,0,0,0.12)] z-30">
                <div className="flex gap-3">
                    <button 
                        onClick={startCollage}
```

**Replace with:**

```ts
            {/* Pinned Floating Generate Button Footer */}
            <div className="shrink-0 p-4 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-[0_-6px_20px_rgba(0,0,0,0.12)] z-30">
                <ImageModelIssue
                  model={currentImageModel}
                  needs={imageModelNeeds}
                  className="mb-2 text-xs font-semibold text-red-600"
                />
                <div className="flex gap-3">
                    <button 
                        onClick={startCollage}
```

**Find** in `App.tsx`:

```ts
                        onClick={startCollage}
                        disabled={isGenerating}
```

**Replace with:**

```ts
                        onClick={startCollage}
                        disabled={isGenerating || imageModelBlocked}
```

## Step 12: `components/ImageEditor.tsx`

**Find** in `components/ImageEditor.tsx`:

```ts
import { editImage } from '../services/geminiService';
```

**Replace with:**

```ts
import { editImage } from '../services/geminiService';
import { DEFAULT_IMAGE_MODEL_ID } from '../shared/imageModels';
import { MASK_REFERENCE_ONLY_NOTE } from '@hk01/pi-ai-extra-image-kit';
import { findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
```

The editor reads the edit route's model list to know whether the selected model edits masks precisely:

**Find** in `components/ImageEditor.tsx`:

```ts
  selectedModel = 'gemini-nano-banana-2.1' as ImageModelType 
}) => {
  const [mode, setMode] = useState<'view' | 'prompt' | 'mask' | 'multi-mask' | 'crop' | 'logo'>('view');
```

**Replace with:**

```ts
  selectedModel = DEFAULT_IMAGE_MODEL_ID
}) => {
  // The edit route's model list: whether the selected model edits masks precisely.
  const { models: editModels } = useImageModels('edit');
  const editModel = findImageModel(editModels, selectedModel);
  const [mode, setMode] = useState<'view' | 'prompt' | 'mask' | 'multi-mask' | 'crop' | 'logo'>('view');
```

Models other than the Nano Banana family read the brush strokes and the AI-logo mask only as a reference image, so an edit can also change areas outside them. Show the note under the mode description:

**Find** in `components/ImageEditor.tsx`:

```ts
                    {mode === 'logo' && "上傳品牌 Logo，即時套用或使用 AI 智能擦除並替換。"}
                </p>
```

**Replace with:**

```ts
                    {mode === 'logo' && "上傳品牌 Logo，即時套用或使用 AI 智能擦除並替換。"}
                </p>
                {(mode === 'mask' || mode === 'multi-mask' || mode === 'logo') && editModel?.maskEditing === 'reference-only' && (
                    <p className="text-amber-400 text-[11px] mt-2 leading-relaxed">{MASK_REFERENCE_ONLY_NOTE}</p>
                )}
```

## Step 13: check Part 2

1. `npm run lint` passes.
2. `App.tsx` no longer contains `'nano-banana-pro'`, `Pro思考`, `PRICE_PER_OUTPUT_IMAGE_USD` or `setSelectedModel('`.
3. `services/usageService.ts` no longer contains `pricePerImage`.
4. Reply with every file you created or changed, and every step where the code did not match exactly and how you applied it.

Image generation still does not work until Part 3 is done. Do not start Part 3 until the user sends it.
