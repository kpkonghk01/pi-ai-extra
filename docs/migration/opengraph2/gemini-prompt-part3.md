# opengraph2 migration, Part 3 of 3: image requests, cancelling and errors

Continue the same task. Parts 1 and 2 are already applied, and their rules and edit format still apply.

This part changes the three places that call the image routes:

- 開始生成 (`generateOG`);
- the deep editor's 執行標記修改 (`executeDeepEdit`);
- AI 智能擦除並替換 Logo (`handleAiEraseAndReplaceLogo`).

They read the server's NDJSON stream with the image kit's `postImageRequest()`. Model and provider errors go to the error panel mounted in Part 2. The 取消 button really cancels. Two selected ratios no longer depend on each other. The estimated cost uses the selected model's price.

## Step 1: `src/types.ts`

Replace the old token price table with the USD→HKD rate. The model prices now come from `server/imageModels.ts` (USD per image).

The old table was labelled HKD, but its numbers are Google's USD prices. For example, Nano Banana 2 was 1120 tokens × 60 / 1M = 0.067, which is Google's US$0.067 per 1K image. The monthly total in HKD was therefore about 7.8 times too low.

**Find** in `src/types.ts`:

```ts
export const MODEL_PRICING = {
  'gemini-nano-banana-2.1': { // Nano Banana 2.1
    input: 0,
    outputPerMillion: 50, // $50 HKD per 1M tokens
    output1K: 1000, // 1000 tokens ($0.050)
    output2K: 1500, // 1500 tokens ($0.075)
    output4K: 2200, // 2200 tokens ($0.110)
    output512: 600, // 600 tokens ($0.030)
  },
  'gemini-3.1-flash-image': { // Nano Banana 2
    input: 0,
    outputPerMillion: 60, // $60 HKD per 1M tokens
    output1K: 1120, // 1120 tokens ($0.067)
    output2K: 1680, // 1680 tokens ($0.101)
    output4K: 2520, // 2520 tokens ($0.151)
    output512: 747, // 747 tokens ($0.045)
  },
  'gemini-3-pro-image': { // Nano Banana Pro
    inputPerImage: 560, // 560 tokens ($0.0011)
    outputPerMillion: 120, // $120 HKD per 1M tokens
    output1Kto2K: 1120, // 1120 tokens ($0.134)
    output4K: 2000, // 2000 tokens ($0.24)
  }
};
```

**Replace with:**

```ts
/** Converts the models' USD price estimates (server/imageModels.ts) to the HKD shown in the app. */
export const USD_TO_HKD = 7.8;
```

## Step 2: imports in `src/App.tsx`

**Find** in `src/App.tsx`:

```tsx
  WHITELIST, RATIO_OPTIONS, MODEL_PRICING, DEFAULT_IMAGE_MODEL_ID,
```

**Replace with:**

```tsx
  WHITELIST, RATIO_OPTIONS, USD_TO_HKD, DEFAULT_IMAGE_MODEL_ID,
```

**Find** in `src/App.tsx`:

```tsx
import { MASK_REFERENCE_ONLY_NOTE, TEMPERATURE_SUPPORT_NOTE, modelIssue } from '@hk01/pi-ai-extra-image-kit';
```

**Replace with:**

```tsx
import {
  MASK_REFERENCE_ONLY_NOTE, TEMPERATURE_SUPPORT_NOTE, estimateImageCostUsd, estimateInputTokens, modelIssue,
} from '@hk01/pi-ai-extra-image-kit';
import { ImageRequestError, isAbort, postImageRequest, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
```

## Step 3: a cancel handle for 開始生成

**Find** in `src/App.tsx`:

```tsx
  const [isGenerating, setIsGenerating] = useState(false);
```

**Replace with:**

```tsx
  const [isGenerating, setIsGenerating] = useState(false);
  /** Aborts the generation in progress (取消). */
  const generateAbortRef = useRef<AbortController | null>(null);
```

## Step 4: AI 智能擦除並替換 Logo (`handleAiEraseAndReplaceLogo`)

The request now goes through `postImageRequest()`, which reads the server's NDJSON stream. It sends the canvas `width:height`, so the result keeps the image's aspect. Google models keep it by themselves; for other models the server sends the nearest ratio the model supports. The result is then centre-cropped to the canvas size with the existing `cropAndResizeToExact()`, instead of being stretched.

**Find** in `src/App.tsx`:

```tsx
      const res = await fetch('/api/deep-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data, promptText, model: state.selectedModel })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `AI 智能擦除失敗 (${res.status})`);
      }

      const data = await res.json();
      if (!data.newImageUrl) throw new Error('AI 未能返回修復後的圖片');

      // Load AI repaired image into canvas
      const aiImg = new Image();
      aiImg.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        aiImg.onload = resolve;
        aiImg.onerror = reject;
        aiImg.src = data.newImageUrl;
      });
```

**Replace with:**

```tsx
      // One attempt with the selected model; the canvas "width:height" keeps the image's aspect.
      const { imageUrl } = await postImageRequest('/api/deep-edit', {
        base64Data,
        promptText,
        model: state.selectedModel,
        aspectRatio: `${canvas.width}:${canvas.height}`,
      });
      // A model that cannot keep the input aspect returns the nearest ratio: crop it to the canvas size.
      const fittedUrl = await cropAndResizeToExact(imageUrl, canvas.width, canvas.height);

      // Load AI repaired image into canvas
      const aiImg = new Image();
      aiImg.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        aiImg.onload = resolve;
        aiImg.onerror = reject;
        aiImg.src = fittedUrl;
      });
```

Errors from the image request (`ImageRequestError`) go to the error panel, which shows the provider, the model, the error code and the task id. Other errors keep the existing red banner.

**Find** in `src/App.tsx`:

```tsx
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorMessage('AI 智能擦除並替換 Logo 失敗：' + errMsg);
```

**Replace with:**

```tsx
      const errMsg = err instanceof Error ? err.message : String(err);
      if (err instanceof ImageRequestError) {
        reportError(err, 'AI 智能擦除並替換 Logo', { model: state.selectedModel });
      } else {
        setErrorMessage('AI 智能擦除並替換 Logo 失敗：' + errMsg);
      }
```

## Step 5: 執行標記修改 (`executeDeepEdit`)

Make the same change in the deep edit.

**Find** in `src/App.tsx`:

```tsx
      const res = await fetch('/api/deep-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data, promptText, model: state.selectedModel })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `深度編輯失敗 (${res.status})`);
      }

      const data = await res.json();
      const newImageUrl = data.newImageUrl;

      if (newImageUrl) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const img = new Image();
          img.src = newImageUrl;
          img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            setEditHistory(prev => [...prev, canvas.toDataURL()]);
          };
        }
      } else {
        throw new Error("未能生成編輯後的圖片");
      }
```

**Replace with:**

```tsx
      // One attempt with the selected model; the canvas "width:height" keeps the image's aspect.
      const { imageUrl } = await postImageRequest('/api/deep-edit', {
        base64Data,
        promptText,
        model: state.selectedModel,
        aspectRatio: `${canvas.width}:${canvas.height}`,
      });
      // A model that cannot keep the input aspect returns the nearest ratio: crop it to the canvas size.
      const newImageUrl = await cropAndResizeToExact(imageUrl, canvas.width, canvas.height);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.src = newImageUrl;
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setEditHistory(prev => [...prev, canvas.toDataURL()]);
        };
      }
```

**Find** in `src/App.tsx`:

```tsx
      const errMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage('編輯失敗：' + errMsg);
```

**Replace with:**

```tsx
      const errMsg = error instanceof Error ? error.message : String(error);
      if (error instanceof ImageRequestError) {
        reportError(error, '深度編輯', { model: state.selectedModel });
      } else {
        setErrorMessage('編輯失敗：' + errMsg);
      }
```

The tainted-canvas check right after it stays unchanged.

## Step 6: 開始生成 (`generateOG`)

Replace the whole `generateOG` function. Every prompt text in it stays exactly the same. The changes:

1. **Cancelling.** An `AbortController` is created for each run. 取消 (Step 7) aborts the request in flight, and the ratio loop stops. A cancel is not reported as an error.
2. **Ratio.** The old `apiRatio` mapping is removed (for example 300x250 → 4:3). The ratio id itself is sent as `ratio`, and the server picks the model's exact ratio or the nearest one (300x250 → 5:4). The existing `cropAndResizeForAd()` / `cropAndResizeToExact()` still crop to the exact size.
3. **The image request** uses `postImageRequest()` with the selected canonical model ID.
4. **Each ratio has its own `try`/`catch`.** If one of two ratios fails, the other is still generated. Its image is saved to the history, and the failure goes to the error panel with the model and the ratio. Before, the second failure discarded the first image although its cost was already logged.
5. **Cost.** The estimate is the selected model's USD price (`estimateImageCostUsd`) × `USD_TO_HKD`. A model without a verified price is logged as 0 with 「（未計價）」 in the log description. Firestore rules require a cost of 0 or more.
6. **History and log records** store the canonical model ID (`state.selectedModel`), not a display name.
7. **A failed text analysis** goes to the error panel. It no longer shows the generic red 「生成失敗，請檢查 API 金鑰或網路連線」 banner. The input check at the top of the function keeps its red banner.

Replace everything from `const generateOG = async () => {` through the end of that function:

**Replace from** `src/App.tsx`:

```tsx
  const generateOG = async () => {
```

**through:**

```tsx
      setIsGenerating(false);
      setGenerationProgress('');
    }
  };
```

**Replace with:**

```tsx
  const generateOG = async () => {
    const activeTemplate = (state.activeTemplateIndex !== null && state.templateImages[state.activeTemplateIndex]) 
      ? state.templateImages[state.activeTemplateIndex] 
      : null;

    const hasLayoutPromptForSelected = state.selectedRatios.some(ratioId => state.layoutPrompts[ratioId]?.trim());
    if (state.sourceImages.length === 0 || (!state.prompt.trim() && !hasLayoutPromptForSelected && !state.isMangaMode && !state.isCustomMangaMode)) {
      setErrorMessage('請上傳素材圖片，並在「文字指令」或選取「漫畫化」/「獨立佈局指令」中填寫要求');
      return;
    }

    setIsGenerating(true);
    setGenerationProgress('正在分析樣板與指令...');
    // One controller per run: 取消 aborts the request in flight and stops the ratio loop.
    const abort = new AbortController();
    generateAbortRef.current = abort;

    try {
      // Construct manga style instructions if enabled
      let mangaInstruction = '';
      if (state.isMangaMode) {
        mangaInstruction += `\n\n【日本漫畫化特別指示】：所有物件、背景、人物、產品及建築等均必須以經典日本漫畫風格生成與繪製（除非用戶指令中明確指定某物件或人物必須維持真實寫實風格）。`;
      }
      if (state.isCustomMangaMode && state.customMangaPrompt.trim()) {
        mangaInstruction += `\n\n【訂製漫畫風格特別指示】：${state.customMangaPrompt.trim()}`;
      }

      // Construct brand logo & isolation instructions
      let brandIsolationInstruction = '';
      if (state.prohibitPretrainedBrandData) {
        brandIsolationInstruction = `\n\n【品牌與 Logo 嚴格隔離安全規範（禁止使用預訓練品牌數據 - 已點亮啟用）】：
本生成流程嚴格禁止 AI 模型從其預訓練數據庫 (Pre-trained Memory) 中檢索、推導、繪製或生成任何已知第三方品牌 Logo、標誌、商標（Trademarks）或版權圖案資料。
1. 若用戶未上傳自訂品牌 Logo 圖片，絕對禁止在畫面中自行創建、繪製或捏造任何品牌 Logo 或標誌。
2. 若用戶上傳了自訂品牌 Logo 圖片，僅允許 100% 使用用戶明確提供的這張 Logo 圖片，嚴禁額外加入任何模型記憶庫中的第三方標誌。`;
      } else {
        brandIsolationInstruction = `\n\n【品牌與 Logo 規範】：允許模型根據用戶提示詞需求靈活參考或使用相關品牌視覺元素與預訓練知識。`;
      }

      // 1. Gemini 3.8 Flash Analysis via Server
      const promptText = `你是一位專業的平面設計與 Open Graph 視覺排版大師。你的核心任務是解構用戶提供的【樣板圖片 (Style Template)】，確保新生成的圖片能完美繼承樣板的品牌特徵、標題字體外觀風格、文字顏色與美術氛圍。
              
              核心強制任務：
              1. 【品牌 Logo 提取與保留】：
                 - 識別樣板圖片中的品牌 Logo（通常位於左上角、右上角或四個角落）。
                 - 記錄 Logo 的精確位置、大小比例與透明度。
                 - 在佈局指令中強制要求「像素級 1:1 複製」該 Logo 到新圖片對應位置（若用戶有提供新 Logo 則替換）。
              
              2. 【樣板標題字體風格與色彩深度解構 (Typography & Color Transfer)】：
                 - 深入觀察樣板圖片的主標題文字（Headline）：
                   a. 字體類型與字重（Typeface & Weight）：精準分析字體骨架（例如：特粗現代無襯線黑體 Heavy Bold Sans-Serif、超粗黑體、緊湊粗體、粗圓體、明體等），記錄其筆畫厚重度與力量感。
                   b. 文字色彩（Text Color）：精準提取標題的顏色（如：純白 #FFFFFF、亮黃色、高對比反白），註明文字主色。
                   c. 描邊與外框處理規範（Stroke Directives - 最高優先級）：
                      ${state.antiTextStroke ? `
                      - 【用戶已啟用「純色無描邊」強制規範】：
                        無論樣板圖片本身是否帶有白色描邊或黑色外框，你在輸出佈局描述時，【絕對不可】指示生成模型繪製任何描邊！
                        你必須在佈局描述中強制規定：
                        『【標題文字邊界硬性規範】：文字必須為純平單色向量實心字（100% Flat Solid Fill），描邊寬度強制為 0（Zero Stroke Width, Borderless），筆畫邊界直接與底層背景相切，嚴禁出現任何外圍白色包邊或第二層輪廓！』` : `
                      - 仔細檢查樣板文字是否有描邊，記錄其描邊色彩與粗細；若無描邊則指示純色實心字。`}
                   d. 文字底襯/色塊（Text Banner / Backing Box）：若標題背後有專屬底色塊（如紅底白字、黃底黑字色帶），請記錄並指示複製；若為無底襯純字懸浮，指示維持純字懸浮。
              
              3. 【整體美術風格與視覺基調 (Artistic Aesthetics)】：
                 - 深度解析樣板的色彩基調、冷暖色調、明暗對比、顆粒質感與平面排版構圖美學，指示生成模型在更換素材後完全保持同等的美術質感。
              
              用戶指令：${state.prompt || '(未填寫，請參考各比例的獨立佈局指令)'}${mangaInstruction}${brandIsolationInstruction}
              
              通用規則：
              1. 標題字體與色彩克隆：新文字標題必須高度繼承樣板的字體架構、厚重字重與色彩搭配。
              2. 嚴禁自主綑邊：嚴禁模型擅自加任何外框描邊或綑邊效果，保持乾淨高質感的平面文字。
              3. 人物保護：100% 像素級保留用戶素材中的人物五官特徵，嚴禁自行繪製新人物。
              4. 避免遮擋：Logo 與標題文字絕對禁止遮擋主要人物面孔。
              ${state.prohibitPretrainedBrandData ? '5. 品牌安全隔離：嚴禁調用或生成預訓練數據庫中的任何第三方品牌標誌或資料。' : ''}
              
              請輸出結構化、極其詳盡的佈局描述，重點涵蓋：Logo 位置、標題字體與色彩詳細規格、描邊限制規範、素材人物融合方式、以及整體美術風格調色。`;

      const analyzeRes = await fetch('/api/analyze-og', {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptText,
          activeTemplate,
          sourceImages: state.sourceImages,
          brandLogo: state.brandLogo,
          reasoningModel: 'gemini-3.8-flash',
        })
      });

      if (!analyzeRes.ok) {
        const errData = await analyzeRes.json().catch(() => ({}));
        throw new Error(errData.error || `分析樣板指令失敗 (${analyzeRes.status})`);
      }

      const analyzeData = await analyzeRes.json();
      const refinedPrompt = analyzeData.refinedPrompt;
      console.log('Refined Prompt:', refinedPrompt);
      
      setGenerationProgress('正在生成圖片...');

      const newResults: OGImage[] = [];

      for (const ratioId of state.selectedRatios) {
        if (abort.signal.aborted) break;
        const ratio = RATIO_OPTIONS.find(r => r.id === ratioId)!;
        const layoutPrompt = state.layoutPrompts[ratioId] || '';
        const is300x250 = ratioId === '300x250' || ratioId === '300:250';
        const is336x280 = ratioId === '336x280' || ratioId === '336:280';
        const is300x600 = ratioId === '300x600' || ratioId === '300:600';
        const is320x480 = ratioId === '320x480' || ratioId === '320:480';
        const is300x300 = ratioId === '300x300' || ratioId === '300:300';

        // The ratio id itself is sent: image-kit picks the model's exact ratio or the nearest one,
        // and the crop below makes the output size exact.
        
        const isAdRatio = is300x250 || is336x280 || is300x600 || is320x480 || is300x300;
        const dedicatedAdInstruction = isAdRatio ? `
                
                【${ratio.label} 廣告專用比例特別防切邊要求】：
                1. 畫面與內縮安全區域（Safe Area Margin）：這是 ${ratio.width}x${ratio.height}px 直式/橫式廣告規格。請務必確保所有主體（人物/產品）、左上角/角落 Logo、標題文字、副標題與說明標籤完全收錄在畫面中央區域，保留至少 15% 的內縮邊距（Safe Padding），絕對禁止任何內容貼近或超出邊緣！
                2. 緊湊中央佈局（Centered Compact Layout）：請將主體與文字適度縮放並集中在畫框中間 80% 的區域，四周留出充足的背景空間，預防裁切。` : '';

        const generatorBrandRule = state.prohibitPretrainedBrandData ? `
                3. 【禁止使用預訓練數據庫品牌資料】：嚴禁從 AI 預訓練數據庫中產生、捏造或補全任何第三方品牌 Logo、標誌、商標或商業標示！${state.brandLogo ? '僅可繪製用戶提供之特定 Logo 圖片。' : '未上傳用戶 Logo 圖片時，生成畫面絕對禁止出現任何品牌 Logo 或商業標誌。'}` : '';

        const typographyCloningRule = (activeTemplate && state.cloneTemplateTypography) ? `
                4. 【樣板標題字體與文字顏色深度克隆 (Typography Style Transfer)】：
                   - 字體形態與筆畫：新圖片中的標題文字必須高度克隆「樣板圖片」中主標題的字體風格、特粗筆畫（Heavy Bold / Extra Black Sans-serif）與排版視覺份量。
                   - 文字色彩完全一致：標題文字必須 100% 繼承「樣板圖片」之色彩方案（如樣板為純白色或鮮黃色，新字必須完全對應相同色彩）。` : '';

        const antiStrokeRule = state.antiTextStroke ? `
                5. 【標題文字純色零描邊強制規範 (Zero Stroke / Borderless Vector Typography)】：
                   - 純平向量字體：所有標題文字必須呈現為純平向量色塊（100% flat solid vector fill typography, unstroked letterforms）。
                   - 零描邊厚度（Stroke width: 0px）：文字筆畫邊緣直接與底層背景相切，字體外圍絕對不允許有任何第二層白色或外圈邊界線（Zero outline, borderless glyphs, seamless edge directly on background）。
                   - 單色均勻平塗：每個中文字僅有其單一實心色彩（如天藍色、桃紅色或純白色），字體內部與邊緣平整純粹，呈現極簡俐落的現代平面字體設計。
                   - 天然對比保障：請在標題文字區域背後自然配合適度深色微漸變或暗角，確保純色平塗文字極致清晰可讀，無需任何外邊裝飾。` : '';

        const generatorPrompt = `請根據以下指令與提供的圖片素材生成高品質圖像。
                
                核心強制要求：
                1. 必須從「樣板圖片」中像素級提取 Logo 並放置在指定位置（如有提供樣板）。
                2. 必須 100% 保留「素材圖片」中的人物特徵。${generatorBrandRule}${typographyCloningRule}${antiStrokeRule}
                
                佈局指令：
                ${refinedPrompt}
                
                目標比例：${ratioId} (${ratio.label})
                額外指令：${layoutPrompt}${dedicatedAdInstruction}`;

        // 2. Image generation with the selected provider/model: one attempt, no fallback.
        try {
          const { imageUrl: rawBase64 } = await postImageRequest('/api/generate-og-image', {
            model: state.selectedModel,
            generatorPrompt,
            activeTemplate,
            sourceImages: state.sourceImages,
            brandLogo: state.brandLogo,
            temperature: state.temperature ?? 0.7,
            ratio: ratioId,
          }, abort.signal);

          let base64 = rawBase64;
          if (is300x250) {
            base64 = await cropAndResizeForAd(rawBase64, 300, 250, 0, 0.05);
          } else if (is336x280) {
            base64 = await cropAndResizeForAd(rawBase64, 336, 280, 0, 0.05);
          } else if (is300x600) {
            base64 = await cropAndResizeForAd(rawBase64, 300, 600, 0, 0.05);
          } else if (is320x480) {
            base64 = await cropAndResizeForAd(rawBase64, 320, 480, 0, 0.05);
          } else if (is300x300) {
            base64 = await cropAndResizeForAd(rawBase64, 300, 300, 0, 0.05);
          } else {
            base64 = await cropAndResizeToExact(rawBase64, ratio.width, ratio.height);
          }
          
          // Estimated cost: the model's USD price converted to HKD; 0 (未計價) when no price is verified.
          const referenceCount = (activeTemplate ? 1 : 0) + state.sourceImages.length + (state.brandLogo ? 1 : 0);
          const costUsd = estimateImageCostUsd(selectedImageModel, {
            resolution: '1K',
            inputImages: referenceCount,
            promptChars: generatorPrompt.length,
          });
          const tokens = estimateInputTokens(referenceCount, generatorPrompt.length);
          const costHkd = costUsd === null ? 0 : costUsd * USD_TO_HKD;
          const costNote = costUsd === null ? '（未計價）' : '';

          const newImg: OGImage = {
            id: Math.random().toString(36).substr(2, 9),
            url: base64,
            ratio: ratioId,
            cost: costHkd,
            tokens: tokens,
            // Canonical model ID (provider:familyId); the UI shows its label.
            model: state.selectedModel,
            timestamp: new Date().toISOString()
          };

          newResults.push(newImg);

          // Log to Firebase
          if (user) {
            try {
              await addDoc(collection(db, 'logs', user.uid, 'entries'), {
                userId: user.uid,
                model: newImg.model,
                tokens: newImg.tokens,
                costHkd: newImg.cost,
                timestamp: newImg.timestamp,
                description: `生成 ${ratioId} OG 圖片${costNote}`
              });
            } catch (error) {
              handleFirestoreError(error, 'create', `logs/${user.uid}/entries`);
              const cachedLogsStr = localStorage.getItem(`logs_${user.uid}`);
              let currentLogs: TokenLog[] = [];
              if (cachedLogsStr) {
                try { currentLogs = JSON.parse(cachedLogsStr); } catch (e) {}
              }
              const fallbackLog: TokenLog = {
                id: Math.random().toString(36).substr(2, 9),
                model: newImg.model,
                tokens: newImg.tokens,
                costHkd: newImg.cost,
                timestamp: newImg.timestamp,
                description: `生成 ${ratioId} OG 圖片${costNote} (本機備份)`
              };
              currentLogs.unshift(fallbackLog);
              setLogs(currentLogs);
              localStorage.setItem(`logs_${user.uid}`, JSON.stringify(currentLogs));
            }
          }
        } catch (error) {
          if (isAbort(error, abort.signal)) break;
          // A failed ratio does not stop the others; each failure is shown in the ErrorPanel.
          console.error(`Generation error (${ratioId}):`, error);
          reportError(error, '圖片生成', { model: state.selectedModel, ratio: ratioId });
        }
      }

      if (user) {
        for (const img of newResults) {
          try {
            const originalBase64 = img.url; // This is the base64 string
            await cacheImageBase64(img.id, originalBase64); // Cache by ID
            
            const finalStorageUrl = await uploadOrCompressImage(img.url, img.id);
            img.url = finalStorageUrl;
            
            // Cache by final storage URL too!
            await cacheImageBase64(finalStorageUrl, originalBase64);
            
            await setDoc(doc(db, 'history', user.uid, 'images', img.id), img);
          } catch (error) {
            handleFirestoreError(error, 'create', `history/${user.uid}/images/${img.id}`);
            const cachedHistoryStr = localStorage.getItem(`history_${user.uid}`);
            let currentHistory: OGImage[] = [];
            if (cachedHistoryStr) {
              try { currentHistory = JSON.parse(cachedHistoryStr); } catch (e) {}
            }
            if (!currentHistory.some(h => h.id === img.id)) {
              currentHistory.unshift(img);
            }
            setHistory(currentHistory);
            localStorage.setItem(`history_${user.uid}`, JSON.stringify(currentHistory));
          }
        }
      } else {
        setHistory(prev => [...newResults, ...prev]);
      }

    } catch (error) {
      // The text analysis failed (image errors are reported per ratio above); 取消 is not an error.
      if (!isAbort(error, abort.signal)) {
        console.error('Generation error:', error);
        reportError(error, '分析樣板與指令', { model: 'gemini-3.8-flash' });
      }
    } finally {
      if (generateAbortRef.current === abort) generateAbortRef.current = null;
      setIsGenerating(false);
      setGenerationProgress('');
    }
  };
```

## Step 7: the 取消 button

**Find** in `src/App.tsx`:

```tsx
              <Button variant="danger" size="sm" className="rounded-full" onClick={() => setIsGenerating(false)}>
```

**Replace with:**

```tsx
              <Button variant="danger" size="sm" className="rounded-full" onClick={() => generateAbortRef.current?.abort()}>
```

A task already submitted to a provider is still billed after 取消. The server only stops waiting for it.

## Step 8: check Part 3

1. `npm run lint` and `npm run build` pass. `npm start` starts the server from `dist/server.mjs`.
2. Search the app. None of these remain: `MODEL_PRICING`, `IMAGE_MODEL_OPTIONS`, `apiRatio`, `callWithRetry`, `modelDisplayName`, `newImageUrl: `, `fetch('/api/generate-og-image'`, `fetch('/api/deep-edit'`, `'gemini-nano-banana-2.1'` (without the `google:` prefix), `process.env.GEMINI_API_KEY` in `vite.config.ts` or `src/`.
3. `@google/genai` is imported only in `server.ts`, for `/api/analyze-og`.
4. Reply with every file you changed, and every step where the code did not match exactly and how you applied it.
