# InfoCard migration, Part 3 of 3: InfoCard, OG 奪舍 and batch tabs

Parts 1 and 2 are done. This part moves the remaining three tools to the image kit. The rules from Part 1 still apply.

## Step 15: `src/components/infocard/InfoCardExpert.tsx`

Apply this diff:

- The image model `<select>` becomes `ImageModelSelector`; its hint uses the card with the most images (template + its source images + brand logo).
- Each card is checked with its own image count before any request. A single card that does not fit is blocked with an explanation; in 「一鍵生成全部」 it is listed as failed and the other cards still run. Full-auto mode stops before the article analysis only when no card can be made at all (no key, or the model list has not loaded).
- Full-auto mode generated the cards from the state before the article analysis (old titles and cards). The analysis now returns the state it applies, and 「一鍵生成全部」 generates from that.
- Single-card failures go to the error panel instead of `alert`.
- 「一鍵生成全部」 still runs one card at a time and continues after a failure; failed cards, with provider and model, are listed in a red box until dismissed. Before, they were only written to the console.

```diff
diff --git a/src/components/infocard/InfoCardExpert.tsx b/src/components/infocard/InfoCardExpert.tsx
index 4d5bd81..4d706d5 100644
--- a/src/components/infocard/InfoCardExpert.tsx
+++ b/src/components/infocard/InfoCardExpert.tsx
@@ -15,6 +15,9 @@ import {
   defaultInfoCardState,
 } from '../../lib/infocardStore';
 import { analyzeArticle, generateCardImage } from '../../lib/infocardApi';
+import { ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
+import { selectedModelIssue } from '@hk01/pi-ai-extra-image-kit';
+import { reportError } from '@hk01/pi-ai-extra-image-kit/browser';
 import { TemplatePairsManager } from './TemplatePairsManager';
 import { TitleReviewPanel } from './TitleReviewPanel';
 import { CoverCardEditor } from './CoverCardEditor';
@@ -52,12 +55,7 @@ const RATIO_OPTIONS: { id: InfoCardRatio; label: string; desc: string }[] = [
   { id: '3:4', label: '3:4 (1242 x 1660px)', desc: '小紅書 / 直式長圖' },
 ];
 
-const IMAGE_MODELS: { id: InfoCardModel; label: string; desc: string }[] = [
-  { id: 'nano-banana-2', label: 'Nano Banana 2 (預設)', desc: '極速生成，適合社交圖卡與多圖拼貼' },
-  { id: 'nano-banana-pro', label: 'Nano Banana Pro', desc: '專業進階，細節豐富與高質感呈現' },
-  { id: 'gpt-image-2', label: 'GPT Image 2 (ToAPIs)', desc: 'ToAPIs 高創意度畫面品質' },
-  { id: 'doubao-seedream-5-0', label: 'Doubao Seedream 5.0 (ToAPIs)', desc: '豆包最新圖像模型，超高畫質表現' },
-];
+const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';
 
 const TEXT_MODELS: { id: InfoCardTextModel; label: string; desc: string }[] = [
   { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (預設)', desc: '最強社交爆款文案生成與重點提煉' },
@@ -77,6 +75,9 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
   const [isArticleAnalyzing, setIsArticleAnalyzing] = useState(false);
   const [isBatchGenerating, setIsBatchGenerating] = useState(false);
   const [batchCompletedCount, setBatchCompletedCount] = useState(0);
+  // Cards that failed in the last "generate all" run, shown until dismissed
+  const [batchFailures, setBatchFailures] = useState<{ label: string; message: string }[]>([]);
+  const imageModels = useImageModels();
   const [editingImageUrl, setEditingImageUrl] = useState<{
     url: string;
     target: 'cover-template' | 'content-template' | 'cover-source' | 'cover-result' | 'content-result';
@@ -102,6 +103,28 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
     setState((prev) => ({ ...prev, ...partial }));
   };
 
+  // Each card sends its template + its own source images + the brand logo.
+  const logoCount = state.brandLogo ? 1 : 0;
+  const cardImageCount = (sourceImages: string[]) => 1 + sourceImages.length + logoCount;
+  // The selector and the hint check the card with the most images.
+  const imageNeeds = {
+    referenceCount: Math.max(cardImageCount(state.coverCard.sourceImages), ...state.contentCards.map((card) => cardImageCount(card.sourceImages))),
+  };
+  const selectedImageModel = findImageModel(imageModels.models, state.selectedModel);
+  /** Why the selected model cannot make a card with this many images, or null. */
+  const cardIssue = (referenceCount: number): string | null => {
+    const issue = selectedModelIssue(selectedImageModel, { referenceCount });
+    return issue && selectedImageModel ? `${selectedImageModel.label}：${issue}` : issue;
+  };
+
+  /** Blocks one card the selected model cannot serve, before any request. */
+  const blockedByModel = (referenceCount: number): boolean => {
+    const issue = cardIssue(referenceCount);
+    if (!issue) return false;
+    alert(t(`${issue}。請改選其他模型或移除部分圖片。`));
+    return true;
+  };
+
   const updateCover = (partial: Partial<typeof state.coverCard>) => {
     setState((prev) => ({
       ...prev,
@@ -244,7 +267,7 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
       // Update state with results
       const rawCoverTags = result.coverTags || (recommended as any)?.tags || (isSimp ? '#时事焦点 #重点懒人包 #必读指南' : '#時事焦點 #重點懶人包 #必讀指南');
       const chosenCoverTags = isSimp ? toSimp(rawCoverTags) : rawCoverTags;
-      setState((prev) => ({
+      const applyAnalysis = (prev: InfoCardState): InfoCardState => ({
         ...prev,
         extractedArticle: result.extractedArticle || null,
         generatedTitleSets: titleSets,
@@ -263,9 +286,11 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
           tags: chosenCoverTags,
         },
         contentCards: newCards.length > 0 ? newCards : prev.contentCards,
-      }));
+      });
+      setState(applyAnalysis);
 
-      return { titleSets, recommended, newCards };
+      // The analysed state, for full-auto generation right after (React state is not updated yet).
+      return { titleSets, recommended, newCards, analysedState: applyAnalysis(state) };
     } catch (err: any) {
       console.error('Article analysis error:', err);
       alert(language === 'sc' ? `文章解析失败: ${err.message || '请确认网址或文字格式'}` : `文章解析失敗: ${err.message || '請確認網址或文字格式'}`);
@@ -294,6 +319,7 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
     const minorTitle = isSimp ? toSimp(rawMinor) : rawMinor;
     const tags = isSimp ? toSimp(rawTags) : rawTags;
 
+    if (blockedByModel(cardImageCount(state.coverCard.sourceImages))) return;
     updateCover({ isGenerating: true });
     try {
       const imageUrl = await generateCardImage({
@@ -319,7 +345,7 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
       updateCover({ resultImage: imageUrl, isGenerating: false });
     } catch (err: any) {
       console.error('Cover generation failed:', err);
-      alert(language === 'sc' ? `封面首图生成失败: ${err.message || '请稍后重试'}` : `封面首圖生成失敗: ${err.message || '請稍後重試'}`);
+      reportError(err, '圖卡生成', { 圖卡: '封面首圖' });
       updateCover({ isGenerating: false });
     }
   };
@@ -341,6 +367,7 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
     const bodyParagraph = isSimp ? toSimp(card.bodyParagraph) : card.bodyParagraph;
     const tags = isSimp ? toSimp(card.tags) : card.tags;
 
+    if (blockedByModel(cardImageCount(card.sourceImages))) return;
     updateContentCard(index, { isGenerating: true });
     try {
       const imageUrl = await generateCardImage({
@@ -368,18 +395,18 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
       updateContentCard(index, { resultImage: imageUrl, isGenerating: false });
     } catch (err: any) {
       console.error(`Card ${index + 1} generation failed:`, err);
-      alert(language === 'sc' ? `内容图卡第 ${index + 1} 张生成失败: ${err.message || '请稍后重试'}` : `內容圖卡第 ${index + 1} 張生成失敗: ${err.message || '請稍後重試'}`);
+      reportError(err, '圖卡生成', { 圖卡: `內容圖卡第 ${index + 1} 張` });
       updateContentCard(index, { isGenerating: false });
     }
   };
 
-  // Batch Generation: Generate all (Cover + all Content cards)
-  const handleGenerateAll = async () => {
-    if (!state.coverCard.templateImage) {
+  // Batch Generation: Generate all (Cover + all Content cards) from `source`
+  const generateAllCards = async (source: InfoCardState) => {
+    if (!source.coverCard.templateImage) {
       alert(language === 'sc' ? '请先上传「封面首图样板图片」！' : '請先上傳「封面首圖樣板圖片」！');
       return;
     }
-    if (!state.contentTemplateImage) {
+    if (!source.contentTemplateImage) {
       alert(language === 'sc' ? '请先上传「内容图卡样板图片」！' : '請先上傳「內容圖卡樣板圖片」！');
       return;
     }
@@ -387,14 +414,24 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
     const isSimp = language === 'sc';
     setIsBatchGenerating(true);
     setBatchCompletedCount(0);
+    setBatchFailures([]);
+    // One card at a time; a failed card is reported and the run continues (no retry, no other model).
+    const failures: { label: string; message: string }[] = [];
+    const recordFailure = (label: string, error: unknown) => {
+      reportError(error, '圖卡生成（一鍵生成全部）', { 圖卡: label });
+      failures.push({ label, message: error instanceof Error ? error.message : String(error) });
+    };
 
     // 1. Generate Cover
     try {
+      // A card the model cannot serve fails here without a request; the run continues.
+      const coverIssue = cardIssue(cardImageCount(source.coverCard.sourceImages));
+      if (coverIssue) throw new Error(`${coverIssue}，未送出。`);
       updateCover({ isGenerating: true });
-      const rawMain = state.coverCard.mainTitle || state.reviewedTitles.mainTitle;
-      const rawSub = state.coverCard.subTitle || state.reviewedTitles.subTitle;
-      const rawMinor = state.coverCard.minorTitle || state.reviewedTitles.minorTitle;
-      const rawTags = state.coverCard.tags;
+      const rawMain = source.coverCard.mainTitle || source.reviewedTitles.mainTitle;
+      const rawSub = source.coverCard.subTitle || source.reviewedTitles.subTitle;
+      const rawMinor = source.coverCard.minorTitle || source.reviewedTitles.minorTitle;
+      const rawTags = source.coverCard.tags;
 
       const mainTitle = isSimp ? toSimp(rawMain) : rawMain;
       const subTitle = isSimp ? toSimp(rawSub) : rawSub;
@@ -403,35 +440,38 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
 
       const coverUrl = await generateCardImage({
         cardType: 'cover',
-        templateImage: state.coverCard.templateImage,
-        sourceImages: state.coverCard.sourceImages,
-        imagePrompt: state.coverCard.imagePrompt,
-        brandLogo: state.brandLogo,
+        templateImage: source.coverCard.templateImage,
+        sourceImages: source.coverCard.sourceImages,
+        imagePrompt: source.coverCard.imagePrompt,
+        brandLogo: source.brandLogo,
         mainTitle,
         subTitle,
         minorTitle,
         tags,
-        eraseTemplateText: state.coverCard.eraseTemplateText,
-        lockBrandLogo: state.coverCard.lockBrandLogo,
-        forbidPretrainedLogo: state.coverCard.forbidPretrainedLogo,
-        forbidHallucinatedText: state.coverCard.forbidHallucinatedText,
-        ratio: state.selectedRatio,
-        resolution: state.selectedResolution,
-        modelId: state.selectedModel,
+        eraseTemplateText: source.coverCard.eraseTemplateText,
+        lockBrandLogo: source.coverCard.lockBrandLogo,
+        forbidPretrainedLogo: source.coverCard.forbidPretrainedLogo,
+        forbidHallucinatedText: source.coverCard.forbidHallucinatedText,
+        ratio: source.selectedRatio,
+        resolution: source.selectedResolution,
+        modelId: source.selectedModel,
         language: language,
       });
       updateCover({ resultImage: coverUrl, isGenerating: false });
       setBatchCompletedCount((prev) => prev + 1);
     } catch (e: any) {
       console.error('Batch cover generation failed:', e);
+      recordFailure('封面首圖', e);
       updateCover({ isGenerating: false });
     }
 
     // 2. Generate Content Cards in sequence
-    for (let i = 0; i < state.contentCards.length; i++) {
-      const card = state.contentCards[i];
-      updateContentCard(i, { isGenerating: true });
+    for (let i = 0; i < source.contentCards.length; i++) {
+      const card = source.contentCards[i];
       try {
+        const issue = cardIssue(cardImageCount(card.sourceImages));
+        if (issue) throw new Error(`${issue}，未送出。`);
+        updateContentCard(i, { isGenerating: true });
         const mainTitle = isSimp ? toSimp(card.mainTitle) : card.mainTitle;
         const subTitle = isSimp ? toSimp(card.subTitle) : card.subTitle;
         const minorTitle = isSimp ? toSimp(card.minorTitle) : card.minorTitle;
@@ -441,10 +481,10 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
         const cardUrl = await generateCardImage({
           cardType: 'content',
           cardIndex: i + 1,
-          templateImage: state.contentTemplateImage,
+          templateImage: source.contentTemplateImage,
           sourceImages: card.sourceImages,
           imagePrompt: card.imagePrompt,
-          brandLogo: state.brandLogo,
+          brandLogo: source.brandLogo,
           mainTitle,
           subTitle,
           minorTitle,
@@ -454,22 +494,26 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
           lockBrandLogo: card.lockBrandLogo,
           forbidPretrainedLogo: card.forbidPretrainedLogo,
           forbidHallucinatedText: card.forbidHallucinatedText,
-          ratio: state.selectedRatio,
-          resolution: state.selectedResolution,
-          modelId: state.selectedModel,
+          ratio: source.selectedRatio,
+          resolution: source.selectedResolution,
+          modelId: source.selectedModel,
           language: language,
         });
         updateContentCard(i, { resultImage: cardUrl, isGenerating: false });
         setBatchCompletedCount((prev) => prev + 1);
       } catch (err) {
         console.error(`Batch content card ${i + 1} failed:`, err);
+        recordFailure(`內容圖卡第 ${i + 1} 張`, err);
         updateContentCard(i, { isGenerating: false });
       }
     }
 
+    setBatchFailures(failures);
     setIsBatchGenerating(false);
   };
 
+  const handleGenerateAll = () => generateAllCards(state);
+
   // Full Auto Workflow
   const handleFullAutoGenerate = async () => {
     if (!state.articleUrl && !state.rawArticleText) {
@@ -485,6 +529,11 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
       return;
     }
 
+    // Stop before paying for the article analysis when no card can be made (no key, list not loaded).
+    if (!selectedImageModel?.available) {
+      alert(t(`${cardIssue(0) ?? '此模型目前不可用'}。請改選其他模型。`));
+      return;
+    }
     setIsBatchGenerating(true);
     setBatchCompletedCount(0);
 
@@ -495,8 +544,8 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
       return;
     }
 
-    // Step d: Generate Cover + Content Cards
-    await handleGenerateAll();
+    // Step d: Generate Cover + Content Cards from the analysed titles and cards
+    await generateAllCards(analysisRes.analysedState);
   };
 
   // Download All generated images
@@ -697,19 +746,20 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
               {/* Image Model */}
               <div className="flex items-center gap-1.5">
                 <span className="font-bold text-zinc-700">{t('圖片模型:')}</span>
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
+                  needs={imageNeeds}
+                  formatLabel={t}
                   className={`bg-white border text-zinc-800 font-semibold rounded-lg px-2.5 py-1 focus:ring-2 cursor-pointer ${
                     isBlue ? 'border-sky-200 focus:ring-sky-300' : 'border-rose-200 focus:ring-rose-300'
                   }`}
-                >
-                  {IMAGE_MODELS.map((m) => (
-                    <option key={m.id} value={m.id}>
-                      {t(m.label)}
-                    </option>
-                  ))}
-                </select>
+                />
               </div>
 
               {/* Text Model */}
@@ -797,6 +847,29 @@ export function InfoCardExpert({ onBackToOgMaster, theme = 'rose' }: InfoCardExp
 
       {/* Main Workspace Area */}
       <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-8">
+        <ImageModelIssue
+          model={selectedImageModel}
+          needs={imageNeeds}
+          formatLabel={t}
+          className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2"
+        />
+
+        {/* Cards that failed in the last "generate all" run */}
+        {batchFailures.length > 0 && !isBatchGenerating && (
+          <section role="status" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-800 space-y-1">
+            <div className="flex items-center justify-between gap-2">
+              <strong>{t(`一鍵生成全部：${batchFailures.length} 張失敗，其餘照常完成（未自動重試或換模型）`)}</strong>
+              <button type="button" onClick={() => setBatchFailures([])} className="text-red-600 underline cursor-pointer">
+                {t('關閉')}
+              </button>
+            </div>
+            {batchFailures.map((failure) => (
+              <p key={failure.label} className="break-words">
+                {t(failure.label)}：{failure.message}
+              </p>
+            ))}
+          </section>
+        )}
         {/* Semi-Auto / Full-Auto Article Input Section */}
         {(state.mode === 'semi-auto' || state.mode === 'full-auto') && (
           <section className={`bg-white rounded-2xl border-2 p-6 shadow-sm space-y-4 ${
```

## Step 16: `src/components/possession/PossessionExpert.tsx`

Apply this diff: the image model `<select>` becomes `ImageModelSelector` (all ten models instead of three), the model names shown in the page and in the history come from the model list, and failures also go to the error panel.

```diff
diff --git a/src/components/possession/PossessionExpert.tsx b/src/components/possession/PossessionExpert.tsx
index 4b2d3c6..18044c5 100644
--- a/src/components/possession/PossessionExpert.tsx
+++ b/src/components/possession/PossessionExpert.tsx
@@ -17,6 +17,9 @@ import { BeforeAfterSlider } from './BeforeAfterSlider';
 import { PresetMaterial } from './sampleData';
 import { DeepEditor } from '../DeepEditor';
 import { downloadImage } from '../../lib/utils';
+import { ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
+import { selectedModelIssue as modelIssueFor } from '@hk01/pi-ai-extra-image-kit';
+import { reportError } from '@hk01/pi-ai-extra-image-kit/browser';
 import {
   Wand2,
   Sparkles,
@@ -42,11 +45,7 @@ const RATIO_OPTIONS: { id: PossessionRatio; label: string; desc: string; aspectC
   { id: '1:1', label: '1:1 (1200 x 1200)', desc: '正方形貼文', aspectClass: 'aspect-square' },
 ];
 
-const IMAGE_MODELS: { id: PossessionImageModel; label: string; desc: string }[] = [
-  { id: 'nano-banana-2', label: 'Nano Banana 2 (預設)', desc: '極速高品質生成・推薦' },
-  { id: 'nano-banana-pro', label: 'Nano Banana Pro', desc: '專業進階・超高細節光影' },
-  { id: 'gpt-image-2', label: 'GPT Image 2 (ToAPIs)', desc: 'ToAPIs 提供之 GPT 圖片模型・高創意度' },
-];
+const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';
 
 export function PossessionExpert() {
   const { language } = useLanguage();
@@ -57,6 +56,7 @@ export function PossessionExpert() {
   const [elapsedTime, setElapsedTime] = useState(0);
   const [statusMessage, setStatusMessage] = useState<string | null>(null);
   const [errorMessage, setErrorMessage] = useState<string | null>(null);
+  const imageModels = useImageModels();
   const [showHistoryModal, setShowHistoryModal] = useState(false);
 
   // DeepEditor integration
@@ -147,6 +147,13 @@ export function PossessionExpert() {
   };
 
   // Step 5: Start OG Metamorphosis Generation
+  // Template + material image + brand logo, as sent by /api/possession/generate
+  const imageNeeds = { referenceCount: 2 + (state.brandLogo ? 1 : 0) };
+  const selectedImageModel = findImageModel(imageModels.models, state.selectedImageModel);
+  const selectedModelIssue = modelIssueFor(selectedImageModel, imageNeeds);
+  // Removed models in old history items have no entry any more; their id is shown instead.
+  const modelLabel = (id: string) => findImageModel(imageModels.models, id)?.label ?? id;
+
   const handleStartPossession = async () => {
     if (!state.templateImage) {
       setErrorMessage('請先上載「參考樣板圖」以提供排版風格');
@@ -156,6 +163,10 @@ export function PossessionExpert() {
       setErrorMessage('請先上載「新圖片素材」以提供人物與產品主體');
       return;
     }
+    if (selectedModelIssue) {
+      setErrorMessage(`目前模型「${selectedImageModel?.label ?? state.selectedImageModel}」${selectedModelIssue}，請改選其他模型或移除品牌 Logo。`);
+      return;
+    }
 
     setIsGenerating(true);
     setErrorMessage(null);
@@ -211,6 +222,7 @@ export function PossessionExpert() {
       }, 500);
     } catch (err: any) {
       console.error('OG Possession generation error:', err);
+      reportError(err, 'OG 奪舍生成');
       setErrorMessage(err.message || 'OG 奪舍生成失敗，請稍後再試');
     } finally {
       setIsGenerating(false);
@@ -304,17 +316,18 @@ export function PossessionExpert() {
             {/* Image Model Selector */}
             <div className="flex items-center gap-2">
               <span className="text-xs font-bold text-zinc-700">圖片模型：</span>
-              <select
+              <ImageModelSelector
+                models={imageModels.models}
+                loading={imageModels.loading}
+                failed={imageModels.failed}
+                onReload={imageModels.reload}
                 value={state.selectedImageModel}
-                onChange={(e) => updateState({ selectedImageModel: e.target.value as PossessionImageModel })}
+                onChange={(id) => updateState({ selectedImageModel: id })}
+                defaultModelId={DEFAULT_IMAGE_MODEL_ID}
+                needs={imageNeeds}
                 className="text-xs font-bold bg-zinc-50 border border-zinc-300 rounded-lg px-2.5 py-1.5 text-zinc-800 hover:border-zinc-400 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden cursor-pointer"
-              >
-                {IMAGE_MODELS.map((m) => (
-                  <option key={m.id} value={m.id}>
-                    {m.label}
-                  </option>
-                ))}
-              </select>
+              />
+              <ImageModelIssue model={selectedImageModel} needs={imageNeeds} className="text-xs font-semibold text-red-600" />
             </div>
 
             {/* Aspect Ratio Selector */}
@@ -432,11 +445,7 @@ export function PossessionExpert() {
                       第 5 步：按照樣板圖風格生成 OG 圖
                     </h3>
                     <span className="px-2 py-0.5 rounded-md bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 text-[10px] font-bold">
-                      {state.selectedImageModel === 'gpt-image-2'
-                        ? 'GPT Image 2 (ToAPIs)'
-                        : state.selectedImageModel === 'nano-banana-pro'
-                        ? 'Nano Banana Pro'
-                        : 'Nano Banana 2'} · {state.selectedRatio} (1K)
+                      {modelLabel(state.selectedImageModel)} · {state.selectedRatio} (1K)
                     </span>
                   </div>
                   <p className="text-[11px] text-zinc-300 truncate mt-0.5">
@@ -450,7 +459,7 @@ export function PossessionExpert() {
               <button
                 type="button"
                 onClick={handleStartPossession}
-                disabled={isGenerating || !state.templateImage || !state.materialImage}
+                disabled={isGenerating || selectedModelIssue !== null || !state.templateImage || !state.materialImage}
                 className="w-full sm:w-auto px-6 sm:px-8 py-3.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-zinc-950 font-black text-sm sm:text-base rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none shrink-0"
               >
                 {isGenerating ? (
@@ -537,11 +546,7 @@ export function PossessionExpert() {
                   <span className="hidden md:inline text-xs font-normal text-zinc-400">(OG 奪舍重構)</span>
                 </h3>
                 <span className="px-2 py-0.5 rounded-md bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 text-[10px] font-bold">
-                  {state.selectedImageModel === 'gpt-image-2'
-                    ? 'GPT Image 2 (ToAPIs)'
-                    : state.selectedImageModel === 'nano-banana-pro'
-                    ? 'Nano Banana Pro'
-                    : 'Nano Banana 2'} · {state.selectedRatio} (1K)
+                  {modelLabel(state.selectedImageModel)} · {state.selectedRatio} (1K)
                 </span>
               </div>
               <p className="text-[11px] text-zinc-300 truncate mt-0.5">
@@ -556,7 +561,7 @@ export function PossessionExpert() {
             type="button"
             id="btn-sticky-launch-possession"
             onClick={handleStartPossession}
-            disabled={isGenerating || !state.templateImage || !state.materialImage}
+            disabled={isGenerating || selectedModelIssue !== null || !state.templateImage || !state.materialImage}
             className="w-full sm:w-auto px-7 py-3 sm:py-3.5 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-zinc-950 font-black text-sm sm:text-base rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none shrink-0"
           >
             {isGenerating ? (
@@ -658,7 +663,7 @@ export function PossessionExpert() {
                           {item.ratio}
                         </span>
                         <span className="text-[10px] px-1.5 py-0.2 bg-indigo-100 text-indigo-700 rounded font-medium">
-                          {item.model === 'gpt-image-2' ? 'GPT Image 2' : item.model === 'nano-banana-pro' ? 'Nano Banana Pro' : 'Nano Banana 2'}
+                          {modelLabel(item.model)}
                         </span>
                       </div>
                     </div>
```

## Step 17: `src/components/batch/BatchExpert.tsx`

Apply this diff:

- The model `<select>` becomes `ImageModelSelector`; models without 4K are disabled while 4K is selected.
- Each slot is checked against the model (style references + its base image + its mask) before anything is sent; a slot that does not fit is marked failed with the reason.
- Requests send the language and read the NDJSON stream. A failed slot shows the provider/model message on its card, goes to the error panel, and the batch continues. Only real successes count for the confetti.
- Prompt Magic called a route that does not exist (`/api/batch-edit/expand-prompt`); it now calls `/api/batch-edit/prompt-magic` and reads `enhancedPrompt`.

```diff
diff --git a/src/components/batch/BatchExpert.tsx b/src/components/batch/BatchExpert.tsx
index e2fc897..58ee2d9 100644
--- a/src/components/batch/BatchExpert.tsx
+++ b/src/components/batch/BatchExpert.tsx
@@ -38,6 +38,10 @@ import {
   SlidersHorizontal,
 } from 'lucide-react';
 import JSZip from 'jszip';
+import { useLanguage } from '../../contexts/LanguageContext';
+import { ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
+import { MASK_REFERENCE_ONLY_NOTE, selectedModelIssue } from '@hk01/pi-ai-extra-image-kit';
+import { isAbort, postImageRequest, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
 import confetti from 'canvas-confetti';
 
 interface BatchExpertProps {
@@ -56,13 +60,7 @@ const ASPECT_RATIOS: { id: BatchAspectRatio; label: string }[] = [
   { id: 'original', label: '保持原圖尺寸' },
 ];
 
-const MODELS: { id: BatchModelId; label: string; desc: string }[] = [
-  { id: 'nano-banana-2', label: 'Google Nano Banana 2 (極速修圖)', desc: '輕快快速圖像生成與修圖模型' },
-  { id: 'nano-banana-pro', label: 'Google Nano Banana Pro (大師旗艦)', desc: '極致細節精準度，適合 4K 大片與細緻光影修復' },
-  { id: 'gpt-image-2', label: 'GPT Image 2 (ToAPIs)', desc: 'ToAPIs 提供之 GPT 圖片模型，高創意度與畫面品質' },
-  { id: 'openrouter-gpt-image-2', label: 'GPT Image 2 (OpenRouter)', desc: 'OpenRouter 渠道之 GPT Image 2 圖片模型' },
-  { id: 'doubao-seedream-5-0', label: 'Doubao Seedream 5.0 (ToAPIs)', desc: '字節跳動頂級圖像大模型' },
-];
+const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';
 
 const RESOLUTIONS: { id: BatchResolution; label: string }[] = [
   { id: '1K', label: '標準 1K (預設)' },
@@ -105,6 +103,8 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
   const [selectedModel, setSelectedModel] = useState<BatchModelId>('nano-banana-2');
   const [selectedRatio, setSelectedRatio] = useState<BatchAspectRatio>('4:5');
   const [selectedResolution, setSelectedResolution] = useState<BatchResolution>('1K');
+  const { language } = useLanguage();
+  const imageModels = useImageModels();
   const [activePreset, setActivePreset] = useState<string | null>(null);
 
   // Custom Capsules (up to 10) & Hidden Presets state
@@ -413,17 +413,21 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
     }
     setIsPromptMagicing(true);
     try {
-      const res = await fetch('/api/batch-edit/expand-prompt', {
+      const res = await fetch('/api/batch-edit/prompt-magic', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ prompt: globalPrompt.trim() }),
       });
-      const data = await res.json();
-      if (data.expandedPrompt) {
-        setGlobalPrompt(data.expandedPrompt);
+      const data = await res.json().catch(() => ({}));
+      if (!res.ok) {
+        throw new Error(data.error || `AI 擴寫失敗 (HTTP ${res.status})`);
+      }
+      if (data.enhancedPrompt) {
+        setGlobalPrompt(data.enhancedPrompt);
       }
     } catch (e) {
       console.error('Prompt magic error:', e);
+      alert(`AI 擴寫失敗：${e instanceof Error ? e.message : String(e)}`);
     } finally {
       setIsPromptMagicing(false);
     }
@@ -459,24 +463,42 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
     );
   };
 
-  // Process a single image card (either image-to-image or text-to-image)
-  const handleGenerateSingle = async (index: number, signal?: AbortSignal) => {
+  // Reference images one slot sends: style references + its base image + its mask
+  const slotReferenceCount = (item: BatchItem) =>
+    referenceImages.length + (item.currentUrl ? 1 : 0) + (item.currentUrl && item.maskUrl ? 1 : 0);
+  const batchImageModel = findImageModel(imageModels.models, selectedModel);
+  const batchNeeds = {
+    referenceCount: Math.max(0, ...items.map(slotReferenceCount)),
+    resolution: selectedResolution,
+  };
+  const usesMaskWithReferenceModel =
+    batchImageModel?.maskEditing === 'reference-only' && items.some((it) => it.currentUrl && it.maskUrl);
+
+  const setSlot = (index: number, partial: Partial<BatchItem>) => {
+    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...partial } : it)));
+  };
+
+  // Process a single image card (either image-to-image or text-to-image). Resolves true on success.
+  const handleGenerateSingle = async (index: number, signal?: AbortSignal): Promise<boolean> => {
     const item = items[index];
-    if (!item) return;
+    if (!item) return false;
 
     const hasImage = Boolean(item.currentUrl);
     const combinedPrompt = [item.dedicatedPrompt?.trim(), globalPrompt?.trim()].filter(Boolean).join("\n\n");
 
     if (!hasImage && !combinedPrompt) {
       alert(`第 ${index + 1} 格目前未上載底圖（文生圖模式），請先在上方全域指令欄或此格輸入生圖指令！`);
-      return;
+      return false;
     }
 
-    setItems((prev) => {
-      const copy = [...prev];
-      copy[index] = { ...copy[index], status: 'generating', errorMessage: null };
-      return copy;
-    });
+    // A slot the selected model cannot serve is marked failed without sending anything.
+    const issue = selectedModelIssue(batchImageModel, { referenceCount: slotReferenceCount(item), resolution: selectedResolution });
+    if (issue) {
+      setSlot(index, { status: 'error', errorMessage: `${batchImageModel?.label ?? selectedModel}：${issue}，未送出。` });
+      return false;
+    }
+
+    setSlot(index, { status: 'generating', errorMessage: null });
 
     try {
       const payload = {
@@ -489,63 +511,34 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
         aspectRatio: selectedRatio,
         resolution: selectedResolution,
         logoConfig: logoConfig.enabled && logoConfig.logoUrl ? logoConfig : null,
+        language,
       };
 
-      const res = await fetch('/api/batch-edit/process-image', {
-        method: 'POST',
-        headers: { 'Content-Type': 'application/json' },
-        body: JSON.stringify(payload),
-        signal,
-      });
-
-      if (!res.ok) {
-        const errData = await res.json().catch(() => ({ error: '生成失敗' }));
-        throw new Error(errData.error || `HTTP ${res.status}`);
-      }
+      const data = await postImageRequest('/api/batch-edit/process-image', payload, signal);
 
-      const data = await res.json();
-      if (!data.imageUrl) {
-        throw new Error('未接收到生成的圖片數據');
-      }
-
-      setItems((prev) => {
-        const copy = [...prev];
-        copy[index] = {
-          ...copy[index],
-          generatedUrl: data.imageUrl,
-          status: 'success',
-          errorMessage: null,
-          splitPosition: 50,
-        };
-        return copy;
+      setSlot(index, {
+        generatedUrl: data.imageUrl,
+        status: 'success',
+        errorMessage: null,
+        splitPosition: 50,
       });
+      return true;
     } catch (err: any) {
-      if (err.name === 'AbortError' || signal?.aborted) {
+      if (isAbort(err, signal)) {
         console.log(`Generation on card #${index + 1} canceled by user.`);
-        setItems((prev) => {
-          const copy = [...prev];
-          copy[index] = {
-            ...copy[index],
-            status: 'idle',
-          };
-          return copy;
-        });
-        return;
+        setSlot(index, { status: 'idle' });
+        return false;
       }
       console.error(`Generation error on card #${index + 1}:`, err);
-      setItems((prev) => {
-        const copy = [...prev];
-        copy[index] = {
-          ...copy[index],
-          status: 'error',
-          errorMessage: err.message || '生成失敗，請檢查提示詞指令或 API Key。',
-        };
-        return copy;
-      });
+      reportError(err, '批量修圖', { 格: `第 ${index + 1} 格` });
+      // The message names the provider and model (for example "kie/nano-banana-2 生成失敗 [timeout]：…").
+      setSlot(index, { status: 'error', errorMessage: err.message || '生成失敗，請檢查提示詞指令或 API Key。' });
+      return false;
     }
   };
 
-  // Batch Process All Slots (with cancellation support)
+  // Batch Process All Slots, one at a time (with cancellation support).
+  // A failed slot is reported on its card and the batch continues; nothing is retried or re-routed.
   const handleBatchGenerateAll = async () => {
     // Check if any slot can be generated
     const hasWorkableSlot = items.some(
@@ -568,9 +561,9 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
         const it = items[i];
         // Generate if slot has an image OR has dedicated prompt OR global prompt exists
         if (it.currentUrl || it.dedicatedPrompt.trim() || globalPrompt.trim()) {
-          await handleGenerateSingle(i, controller.signal);
+          const succeeded = await handleGenerateSingle(i, controller.signal);
           if (controller.signal.aborted) break;
-          successCount++;
+          if (succeeded) successCount++;
         }
       }
     } finally {
@@ -670,23 +663,27 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
           <div className="flex flex-wrap items-center gap-2.5">
             {/* Model Selector */}
             <div className="relative flex items-center">
-              <select
+              <ImageModelSelector
+                models={imageModels.models}
+                loading={imageModels.loading}
+                failed={imageModels.failed}
+                onReload={imageModels.reload}
                 value={selectedModel}
-                onChange={(e) => setSelectedModel(e.target.value as BatchModelId)}
+                onChange={setSelectedModel}
+                defaultModelId={DEFAULT_IMAGE_MODEL_ID}
+                needs={batchNeeds}
                 className={`text-xs font-bold pl-3 pr-7 py-2 rounded-xl border focus:outline-none focus:ring-2 cursor-pointer transition-all appearance-none ${
                   isBlue
                     ? 'bg-sky-50/70 border-sky-200 text-sky-900 focus:ring-sky-300'
                     : 'bg-rose-50/70 border-rose-200 text-rose-900 focus:ring-rose-300'
                 }`}
-              >
-                {MODELS.map((m) => (
-                  <option key={m.id} value={m.id}>
-                    {m.label}
-                  </option>
-                ))}
-              </select>
+              />
               <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 pointer-events-none" />
             </div>
+            <ImageModelIssue model={batchImageModel} needs={batchNeeds} className="w-full text-xs font-semibold text-red-600" />
+            {usesMaskWithReferenceModel && (
+              <p className="w-full text-[11px] font-semibold text-amber-700">{MASK_REFERENCE_ONLY_NOTE}</p>
+            )}
 
             {/* Aspect Ratio Selector */}
             <div className="relative flex items-center">
@@ -1279,7 +1276,7 @@ export const BatchExpert: React.FC<BatchExpertProps> = ({
                 批量狀態: {completedCount} / {items.length} 完成 ({imageCount} 張圖生圖，{items.length - imageCount} 格文生圖)
               </span>
               <span className="text-[10px] text-zinc-400">
-                {MODELS.find((m) => m.id === selectedModel)?.label.replace(/\s*\(.*?\)/, '') || selectedModel} • {selectedResolution} • {selectedRatio}
+                {batchImageModel?.label ?? selectedModel} • {selectedResolution} • {selectedRatio}
               </span>
             </div>
           </div>
```

## Step 18: final check

1. `npm run lint` passes.
2. `npm run build` passes. The `build` and `start` scripts are unchanged (ESM, `dist/server.mjs`).
3. No file under `src/` reads `process.env` or imports `@hk01/pi-ai-extra-image-kit/server`, and `vite.config.ts` has no `define` for keys.
4. No `@google/genai` call remains in the five image routes (`/api/gemini/generate`, `/api/gemini/edit`, `/api/infocard/generate-card`, `/api/possession/generate`, `/api/batch-edit/process-image`). The three text routes still use it.
5. Reply with a summary of every file you changed.
