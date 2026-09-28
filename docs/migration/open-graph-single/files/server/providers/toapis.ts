import { AppImageError, generateAppImage } from "./imageClient";

/**
 * Generate or edit an image with a ToAPIs model through @hk01/pi-ai-extra-toapis.
 * Prompts are unchanged. Uploads go to ToAPIs only; there is no KIE storage fallback,
 * no GPT Image 2.5 -> GPT Image 2 fallback, and no silent reference-image dropping.
 */
export async function generateToAPIsImage({
  modelId,
  globalPrompt,
  ratioPrompt,
  ratio,
  editPrompt,
  templateImage,
  sourceImages,
  brandLogo,
  lockTemplateLogo = true,
  baseImage,
  imageQuality = '1K',
  subjectFitMode = 'crop-zoom',
  keepSourceBackground = true,
  signal,
}: {
  modelId: string;
  globalPrompt?: string;
  ratioPrompt?: string;
  ratio: string;
  editPrompt?: string;
  templateImage?: string;
  sourceImages?: string[];
  brandLogo?: string | null;
  lockTemplateLogo?: boolean;
  baseImage?: string;
  imageQuality?: '1K' | '2K';
  subjectFitMode?: 'crop-zoom' | 'outpaint-fill';
  keepSourceBackground?: boolean;
  signal?: AbortSignal;
}) {
  // Order matters and is described in the prompt: base (edit), template, sources, logo.
  const referenceImages: string[] = [baseImage, templateImage, ...(sourceImages || []), brandLogo].filter(
    (img): img is string => !!img,
  );

  let prompt = "";
  if (editPrompt) {
    prompt = `You are an expert image editor. Your task is to apply the requested edits to the provided image.
CRITICAL RULES:
1. PRESERVE UNMARKED AREAS: Do not change any part of the image that is not explicitly mentioned in the edit instructions.
2. REMOVE STROKES: The provided image may have colored strokes or circles indicating where to edit. You MUST remove these strokes and replace them with the requested content or blend them naturally into the background.
3. FOLLOW INSTRUCTIONS: Apply the edits exactly as requested in the instructions below.
4. PRESERVE ASPECT RATIO: The output image MUST have the exact same aspect ratio as the original image. Do not crop it to a square unless the original is a square.

Edit Instructions:
${editPrompt}`;
  } else {
    const is300x250 = ratio === '300x250' || ratio.includes('300x250');
    const adBannerRules = is300x250 ? `
7. CRITICAL 300x250 AD BANNER SAFE ZONE:
   - This output is a 300x250 display ad banner.
   - You MUST keep ALL text (titles, subtitles, tags) and logos strictly within the central 80% safe region.
   - Leave at least 12% empty horizontal safety margin on both left and right outer edges so no text or logo is placed near the border.
   - Wrap long text titles neatly into 2-3 shorter lines to stay within the safe width.
` : '';

    const logoText = brandLogo
      ? "6. BRAND LOGO (CRITICAL): 100% pixel-perfect copy of the provided brand logo image. Place in the top left or top right corner. Do NOT guess or use web search/memory."
      : (lockTemplateLogo !== false
        ? `6. 像素級鎖定複製品牌Logo (CRITICAL MANDATE - PIXEL-PERFECT BRAND LOGO LOCK & CLONE):
   - 1）嚴禁使用圖片模型或大模型訓練數據庫中的資料及舊品牌Logo去生成新圖片的Logo。(STRICTLY FORBIDDEN from using training data, internal memory, or obsolete database logos).
   - 2）嚴格禁止模型啟動web search去尋找互聯網上的Logo用作生成。(STRICTLY FORBIDDEN from web search for logos).
   - 3）像素級鎖定「樣板圖片」中的品牌Logo並複製它到新生成的圖片中。(PIXEL-PERFECT LOCK: Clone exact logo from style template onto new image).`
        : "6. LOGO: If there is a logo in the style template (usually top right or top left), 100% pixel-perfect copy it to the new image.");

    const subjectFitRule = subjectFitMode === 'outpaint-fill'
      ? `3. CRITICAL: STRICT SUBJECT PROPORTION & OUTPAINTING RULE (左右擴圖填滿模式 - 防止橫向壓扁/拉寬):
   - STRICT FACIAL & ANATOMICAL RATIO LOCK: Absolutely preserve the native natural aspect ratio and facial bone structure of all human subjects from the source images. Any horizontal stretching, squashing, or anamorphic distortion of faces, eyes, or bodies is STRICTLY FORBIDDEN.
   - When the source subject width is narrower than the canvas, DO NOT stretch the subject horizontally.
   - Instead, place the subject naturally on one side (or center) at original proportions and SEAMLESSLY EXTEND (Outpaint) the background environment horizontally to fill the canvas width. The extended background provides clean negative space for typography.
   - 繁體中文排版規範：鎖死人臉與五官原生長寬比，嚴禁橫向拉寬變形。素材寬度不足時，主體以原比例置中或置側，背景向兩側無縫擴圖填滿。`
      : `3. CRITICAL: STRICT SUBJECT PROPORTION & CROPPING RULE (局部裁切特寫模式 - 防止橫向壓扁/拉寬):
   - STRICT FACIAL & ANATOMICAL RATIO LOCK: Absolutely preserve the native natural aspect ratio and facial bone structure of all human subjects from the source images. Any horizontal stretching, squashing, or anamorphic distortion of faces, eyes, or bodies is STRICTLY FORBIDDEN.
   - When placing the source subject onto the canvas, NEVER stretch or squash to fit the canvas width.
   - Instead, scale the subject proportionally to fill the composition, naturally cropping non-essential outer areas (e.g. lower torso, shoulders, or empty background edges) while keeping facial features crisp, true to original proportions, and distortion-free.
   - 繁體中文排版規範：鎖死人臉與五官原生長寬比，嚴禁橫向拉寬變形。等比例放大主體並局部裁切多餘邊緣，確保面部清晰端正立體。`;

    const sourceCount = (sourceImages && Array.isArray(sourceImages)) ? sourceImages.length : 0;
    const multiImageCollageMandate = sourceCount > 1 ? `
2. MANDATORY MULTI-IMAGE COLLAGE FOR ALL ${sourceCount} SOURCE IMAGES:
   - CRITICAL INCLUSION: You are provided with ${sourceCount} distinct source images. You MUST include EVERY SINGLE ONE of the ${sourceCount} source images in the final composite image.
   - DO NOT USE ONLY ONE IMAGE: It is STRICTLY FORBIDDEN to pick only the first image or omit any image. All ${sourceCount} subjects must be present and clearly visible.
   - BACKGROUND PRESERVATION MANDATE: Prioritize retaining the background scenes from the uploaded source image materials. Do NOT hallucinate or invent an unrelated new background.
   - Create a balanced multi-subject collage or split/grid layout following the visual aesthetic of the style template.
   - 繁體中文排版鐵律：上傳了共 ${sourceCount} 張素材圖片，必須全部拼貼到新的 OG 圖中，嚴禁只使用第 1 張素材！優先保留素材原圖背景，嚴禁自行憑空創造不相干背景；每一張素材的主體人物都必須同時出現在畫面中。` : `
2. SOURCE PRESERVATION & BACKGROUND RETENTION:
   - You MUST use the provided SOURCE IMAGES. Do NOT modify their faces, expressions, features, or identities. 100% pixel-perfect preservation of the subjects is required.
   - BACKGROUND PRESERVATION: Prioritize retaining the background from the uploaded source image materials; do NOT invent or hallucinate an unrelated background. (優先保留上傳素材的原始背景，嚴禁憑空發明新背景)。`;

    prompt = `You are an expert Open Graph image creator and collage master.
Your task is to create a new Open Graph image based on the provided STYLE TEMPLATE and SOURCE IMAGES.

CRITICAL RULES:
1. CLEAN SLATE: Do NOT include any people, text, or specific objects from the reference style image. The style image is ONLY for layout, typography, colors, and vibe.
${multiImageCollageMandate}
${subjectFitRule}
4. TEXT PLACEMENT: Ensure the text title does NOT obscure the main subjects (especially faces) or important objects.
5. LANGUAGE: The title and any text must be in Traditional Chinese (繁體中文).
${logoText}
${adBannerRules}
Global Instructions & Title:
${globalPrompt || ''}

Specific Layout Instructions for this ratio (${ratio}):
${ratioPrompt || ''}
`;
  }

  const apiModelName = modelId;

  // Function to build prompt based on model and attempt
  const buildPrompt = (isFallback = false) => {
    const subjectFitZh = subjectFitMode === 'outpaint-fill'
      ? `\n- 【重要防變形排版規範 - 左右擴圖填滿模式】：嚴禁在橫向軸線上把人物臉部、眼睛或身形強行拉寬或壓扁（絕對鎖死原生五官比例與骨骼幾何）。當素材主體寬度不足以填滿版面時，切勿橫向拉扯主體；請將主體人物以真實長寬比置於一側或置中，並將背景環境向左右兩側無縫延展擴圖（Outpainting）填滿整個畫面寬度，擴展出的背景空間供標題文字排版使用。`
      : `\n- 【重要防變形排版規範 - 局部裁切特寫模式】：嚴禁在橫向軸線上把人物臉部、眼睛或身形強行拉寬或壓扁（絕對鎖死原生五官比例與骨骼幾何）。切勿為塞入全身而橫向變形，必須將人物主體維持真實比例等比例放大，自然裁切邊緣非核心部分（如胸部以下、肩膀或多餘邊緣背景），確保臉部五官清晰飽滿、真實端正且完全不變形。`;

    const subjectFitRule = subjectFitMode === 'outpaint-fill'
      ? `3. CRITICAL: STRICT SUBJECT PROPORTION & OUTPAINTING RULE (左右擴圖填滿模式 - 防止橫向壓扁/拉寬):
   - STRICT FACIAL & ANATOMICAL RATIO LOCK: Absolutely preserve native natural aspect ratio of all human subjects. Any horizontal stretching, squashing, or anamorphic distortion of faces, eyes, or bodies is STRICTLY FORBIDDEN.
   - When source subject width is narrower than canvas, DO NOT stretch subject horizontally. Place subject naturally at original proportions and SEAMLESSLY EXTEND (Outpaint) background horizontally to fill canvas width.
   - 繁體中文規範：鎖死人臉身形原生比例，嚴禁橫向拉寬。素材寬度不足時，主體以原比例置中或置側，背景向兩側無縫擴圖填滿。`
      : `3. CRITICAL: STRICT SUBJECT PROPORTION & CROPPING RULE (局部裁切特寫模式 - 防止橫向壓扁/拉寬):
   - STRICT FACIAL & ANATOMICAL RATIO LOCK: Absolutely preserve native natural aspect ratio of all human subjects. Any horizontal stretching, squashing, or anamorphic distortion of faces, eyes, or bodies is STRICTLY FORBIDDEN.
   - NEVER stretch or squash to fit canvas width. Scale subject proportionally to fill composition, naturally cropping non-essential outer areas while keeping facial features crisp and distortion-free.
   - 繁體中文規範：鎖死人臉身形原生比例，嚴禁橫向拉寬。等比例放大主體並局部裁切多餘邊緣，確保面部清晰端正立體。`;

    if (editPrompt) {
      if (apiModelName === 'gpt-image-2.5-flare' || apiModelName.startsWith('gpt-image-2.5')) {
        if (isFallback) {
          return `請參考原圖修改：${editPrompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')}`;
        }
        return `請根據參考圖片進行圖像編輯與局部修改。修改要求：${editPrompt}。請移除標記筆劃，保持原圖未修改區域完全一致，確保畫面真實自然。`;
      } else if (apiModelName === 'doubao-seedream-5-0-pro' || apiModelName.startsWith('qwen-image-') || apiModelName.includes('chinese')) {
        if (isFallback) {
          return `請參考所提供的圖片進行修改，修改內容：${editPrompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')}。`;
        }
        return `請根據參考圖片進行圖像編輯與局部修改。修改要求：${editPrompt}。請移除標記筆劃，確保畫面視覺自然協調與真實感。`;
      } else {
        if (isFallback) {
          return `Please apply the requested edit to the image: ${editPrompt.replace(/[\n\r]/g, ' ')}`;
        }
        return `You are an expert image editor. Your task is to apply the requested edits to the provided image.
CRITICAL RULES:
1. PRESERVE UNMARKED AREAS: Do not change any part of the image that is not explicitly mentioned in the edit instructions.
2. REMOVE STROKES: The provided image may have colored strokes or circles indicating where to edit. You MUST remove these strokes and replace them with the requested content or blend them naturally into the background.
3. FOLLOW INSTRUCTIONS: Apply the edits exactly as requested in the instructions below.
4. PRESERVE ASPECT RATIO: The output image MUST have the exact same aspect ratio as the original image.

Edit Instructions:
${editPrompt}`;
      }
    } else {
      if (apiModelName === 'gpt-image-2.5-flare' || apiModelName.startsWith('gpt-image-2.5')) {
        let referenceGuide = "";
        let imgIndex = 1;
        if (templateImage) {
          referenceGuide += `\n- 參考圖 ${imgIndex} 為「樣板圖片 (Style Template)」：請嚴格參考其整體版面佈局、色調美學、字體排列與空間比例；但請勿複製原樣板內的舊文字與舊人物。`;
          imgIndex++;
        }
        if (sourceImages && sourceImages.length > 0) {
          const count = sourceImages.length;
          referenceGuide += `\n- 參考圖 ${imgIndex}${count > 1 ? ` 至 ${imgIndex + count - 1}` : ''} 為「主題素材圖片 (共 ${count} 張素材)」：【多圖拼貼鐵律】用戶上傳了共 ${count} 張素材，必須「全部」以多圖拼貼（Collage）方式融合成一張新圖，嚴禁只挑第 1 張或忽略任何一張！請忠實保留每一張圖片中人物的面容五官與主體特徵，均勻排列於畫面中。`;
          imgIndex += count;
        }
        if (brandLogo) {
          referenceGuide += `\n- 參考圖 ${imgIndex} 為「品牌 Logo」：【像素級鎖定複製品牌Logo鐵律】必須 100% 像素級精準複製此參考圖的品牌 Logo 到新生成圖片的角落（如右上角或左上角），嚴禁任何修改、重繪、簡化或變形！`;
        }

        // 鐵律 1：嚴格沿用素材圖片的背景，禁止自行創作背景，但容許無縫融合
        const backgroundPreservationRule = (keepSourceBackground !== false) ? `
【鐵律：嚴格沿用素材背景與無縫融合規範（嚴禁自行創作不相干背景）】
1. 必須嚴格沿用「上傳新圖片素材」中所帶有的真實背景與現場環境場景，將素材主體連同其原本的真實背景完整保留並置於畫面底層。
2. 嚴禁模型脫離素材自行憑空想像、虛構或創造全新的不相干背景！
3. 容許無縫融合效果：
   - 容許並鼓勵在生成圖片時，將素材圖片的背景進行自然無縫融合（Seamless Blending / Harmonious Integration）；
   - 若因應版面比例（如擴展寬度或高度），允許基於素材原本的背景色調與環境紋理進行自然羽化延伸與無縫擴圖（Seamless Outpainting），避免黑邊或生硬邊界；
   - 若上傳多張素材，各素材背景之間應進行平滑漸層羽化融合，組成渾然一體的背景畫面，消除生硬拼貼切痕。` : `
【背景排版規範】：可依據樣板美學與文字排版需求，和諧構思與微調背景。`;

        // 鐵律 2：像素級鎖定複製品牌Logo
        let logoMandateRule = "";
        if (brandLogo) {
          logoMandateRule = `
【鐵律：像素級鎖定複製品牌Logo（絕對不可妥協之死命令）】
1. 嚴禁使用圖片模型或大模型訓練數據庫中的任何歷史記憶資料、舊款品牌Logo或類似標誌去生成新圖片中的Logo。
2. 嚴格禁止模型啟動 web search 去尋找或猜測互聯網上的Logo用作生成。
3. 必須「100% 像素級精準鎖定並複製」所提供的品牌 Logo 參考圖片，不得篡改、重塑形狀、更換字體、改變顏色或自行繪製，將原 Logo 完整無損複製於畫面角隅（如右上角或左上角）。`;
        } else if (lockTemplateLogo !== false) {
          logoMandateRule = `
【鐵律：像素級鎖定複製品牌Logo（絕對不可妥協之死命令）】
1. 嚴禁使用圖片模型或大模型訓練數據庫中的任何歷史記憶資料、舊款品牌Logo或類似標誌去生成新圖片中的Logo。
2. 嚴格禁止模型啟動 web search 去尋找或猜測互聯網上的Logo用作生成。
3. 必須「像素級鎖定並複製」【樣板圖片 (Style Template)】中所出現的品牌 Logo，完整無誤地複製並移植到新生成的圖片中，絕不容許自行再造或搜尋替換。`;
        }

        const isBanner = ['300x250', '300x300', '336x280', '300x600', '320x480'].includes(ratio);
        const bannerGuide = isBanner ? `\n- 廣告橫幅規格說明：這是一張展示廣告圖片 (${ratio})，請務必將所有核心標題、文字與標誌保持在安全區域內，避免靠邊裁切。` : '';

        if (isFallback) {
          return `請生成高品質圖像，主題：${(globalPrompt || '專業視覺設計').replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')}。所有文字請使用繁體中文。${(keepSourceBackground !== false) ? '嚴格沿用素材圖片的原始背景，禁止自行創造不相干背景，但容許將素材背景自然無縫融合延伸。' : ''} 請參考樣板風格並將全部 ${sourceImages?.length || 1} 張素材以拼貼方式排版。${logoMandateRule ? ' 像素級鎖定並複製參考圖/樣板的品牌Logo。' : ''}${subjectFitZh}`;
        }

        return `請根據所提供的參考圖片生成全新高品質圖像，並嚴格遵循以下不可違反的鐵律：

參考圖定義：${referenceGuide || '請參照所提供的樣板參考圖片風格進行排版。'}

畫面比例：${ratio}
全局設計指示與標題：${globalPrompt || '高質量專業視覺設計'}
尺寸排版補充說明：${ratioPrompt || '標準排版'}
文字規範：所有標題與文字請使用繁體中文，字體清楚端正，請勿遮擋主體人物。${subjectFitZh}${bannerGuide}
${backgroundPreservationRule}
${logoMandateRule}`;
      } else if (apiModelName === 'doubao-seedream-5-0-pro' || apiModelName === 'doubao-seedream-5-0' || apiModelName.startsWith('qwen-image-')) {
        const is300x250 = ratio === '300x250' || ratio.includes('300x250');
        const adRules = is300x250 ? "這是 300x250 廣告橫幅，請確保標題與標註文字保持在中央安全區域。" : "";
        const count = sourceImages?.length || 1;
        const collageNote = count > 1 ? `\n- 多圖拼貼要求：提供的 ${count} 張素材圖片必須全部出現在畫面中，做成和諧的多人物/多主體拼貼，嚴禁只選用 1 張素材。` : '';
        const bgNote = (keepSourceBackground !== false)
          ? `\n- 【嚴格沿用素材背景與無縫融合鐵律】：嚴禁模型自行創作不相干背景！必須直接沿用並保留素材圖片原本的真實背景與現場環境，但容許生成圖片時將素材背景自然無縫融合、邊緣羽化延伸與多圖自然銜接。`
          : '';
        if (isFallback) {
          return `請生成圖像，主題：${(globalPrompt || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')}。所有文字請使用繁體中文。${(keepSourceBackground !== false) ? '嚴格沿用素材圖片原始背景，禁止自創新背景，容許素材背景無縫融合。' : ''}${collageNote}${subjectFitZh}`;
        }
        return `請根據參考風格圖與素材圖片生成全新的 Open Graph 圖像。
設計與主題說明：${globalPrompt || '無'}
尺寸排版需求 (${ratio})：${ratioPrompt || '標準排版'}
文字與語言規範：所有文字請使用繁體中文，字體清楚可讀，避免遮擋人物面部或主體。
${collageNote}
${bgNote}
${subjectFitZh}
${adRules}`;
      } else {
        const count = sourceImages?.length || 1;
        const countNotice = count > 1 ? `ALL ${count} source images must be included in a multi-image collage layout. Do NOT use only one image.` : '';
        const bgRule = (keepSourceBackground !== false)
          ? `3. CRITICAL: STRICT SOURCE BACKGROUND PRESERVATION & SEAMLESS BLENDING: You MUST strictly preserve and use the original real background from the source images. Hallucinating or inventing a new unrelated background is STRICTLY FORBIDDEN. However, seamless blending, soft feathering, and natural outpainting extension of the source background are expressly permitted to achieve a cohesive, boundary-free canvas.`
          : '';
        if (isFallback) {
          return `Create a high quality Open Graph image for: ${globalPrompt || 'Design'} (${ratio}). ${countNotice} ${(keepSourceBackground !== false) ? 'Preserve source background with seamless blending, do not invent unrelated background.' : ''} Preserve exact native aspect ratio of human subjects without horizontal stretching.`;
        }
        const is300x250 = ratio === '300x250' || ratio.includes('300x250');
        const adBannerRules = is300x250 ? `
7. CRITICAL 300x250 AD BANNER SAFE ZONE:
   - This output is a 300x250 display ad banner.
   - Keep ALL text and logos strictly within central safe region.
` : '';

        const logoText = brandLogo
          ? "6. BRAND LOGO: Use provided brand logo reference image. Place in top left or top right corner."
          : "6. LOGO: Place brand logo cleanly in top left or top right.";

        return `You are an expert Open Graph image creator.
Create a new image based on STYLE TEMPLATE and SOURCE IMAGES.
RULES:
1. CLEAN SLATE: Style image is ONLY for layout, colors, and vibe.
2. SOURCE PRESERVATION & COLLAGE: ${count > 1 ? `You MUST include ALL ${count} source images in a balanced collage. Do NOT pick only the first image.` : `Preserve source subject accurately.`}
${subjectFitRule}
${bgRule}
4. LANGUAGE: Text must be in Traditional Chinese (繁體中文).
${logoText}
${adBannerRules}
Title & Prompt:
${globalPrompt || ''}
Layout (${ratio}):
${ratioPrompt || ''}`;
      }
    }
  };


  const run = (currentPrompt: string) =>
    generateAppImage({
      appModelId: modelId,
      prompt: currentPrompt,
      referenceImages,
      ratio,
      quality: imageQuality || "1K",
      signal,
    });

  try {
    return await run(buildPrompt(false));
  } catch (firstErr) {
    // Same provider and model, simplified prompt: an explicit app choice (a second billed task), not a fallback.
    if (firstErr instanceof AppImageError && firstErr.code === "content_blocked") {
      console.warn("[ToAPIs] Safety review blocked the primary prompt; retrying once with the simplified prompt.");
      return await run(buildPrompt(true));
    }
    throw firstErr;
  }
}
