import { generateAppImage } from "./imageClient";

export interface KieGenerateOptions {
  modelId: string;
  globalPrompt?: string;
  ratioPrompt?: string;
  ratio?: string;
  templateImage?: string | null;
  sourceImages?: string[];
  brandLogo?: string | null;
  lockTemplateLogo?: boolean;
  editPrompt?: string;
  baseImage?: string | null;
  imageQuality?: '1K' | '2K';
  subjectFitMode?: 'crop-zoom' | 'outpaint-fill';
  keepSourceBackground?: boolean;
  signal?: AbortSignal;
}

/**
 * Generate or edit an image with a KIE model through @hk01/pi-ai-extra-kie.
 * The prompt is unchanged; upload, task polling and result download are handled by the package.
 */
export async function generateKieImage(options: KieGenerateOptions): Promise<string> {
  const {
    modelId,
    globalPrompt = "",
    ratioPrompt = "",
    ratio = "16:9",
    templateImage,
    sourceImages = [],
    brandLogo,
    lockTemplateLogo,
    editPrompt,
    baseImage,
    imageQuality = "1K",
    subjectFitMode = "crop-zoom",
    keepSourceBackground = true,
    signal,
  } = options;

  const isEditMode = !!editPrompt;
  // Order matters and is described in the prompt: template first, then sources, then logo.
  const referenceImages: string[] = isEditMode
    ? [baseImage].filter((img): img is string => !!img)
    : [templateImage, ...(sourceImages || []), brandLogo].filter((img): img is string => !!img);

  // Construct prompt
  let promptText = "";
  if (isEditMode) {
    promptText = editPrompt || "Please edit the image according to the instructions.";
  } else {
    const is300x250 = ratio === '300x250' || ratio.includes('300x250');
    const adBannerRules = is300x250 ? `
7. CRITICAL 300x250 AD BANNER SAFE ZONE:
   - This output is a 300x250 display ad banner.
   - Keep ALL text (titles, subtitles, tags) and logos strictly within central safe region.
` : '';

    const logoRule = brandLogo
      ? "6. BRAND LOGO: Use provided brand logo reference image. Place in top left or top right corner."
      : (lockTemplateLogo !== false
        ? `6. 像素級鎖定複製品牌Logo (CRITICAL MANDATE - PIXEL-PERFECT BRAND LOGO LOCK & CLONE):
   - 1）嚴禁使用圖片模型訓練資料庫舊Logo或由網絡隨意搜尋。(STRICTLY FORBIDDEN from using training memory or web search for logos).
   - 2）像素級鎖定第1張「樣板圖片」中的品牌Logo並複製到新生成圖片中。(PIXEL-PERFECT LOCK: Clone exact logo from template image onto new image).`
        : "6. LOGO: Place brand logo cleanly in top left or top right.");

    const sourceCount = (sourceImages && Array.isArray(sourceImages)) ? sourceImages.length : 0;
    const templateInstruction = templateImage ? `
CRITICAL REFERENCE IMAGE ROLES & STYLE TEMPLATE MANDATE:
- Reference Image 1 is the STYLE & COMPOSITION TEMPLATE (當前樣板圖片).
  * You MUST follow this template's visual layout, background composition, color grading, decorative graphic shapes, framing, banner styling, and typography zones.
  * The resulting image MUST look visually cohesive and belong to the EXACT SAME visual template series as this template image.
  * Replace the old person face and old text from the template with the new source subjects and new title, while strictly keeping the template's framing, layout architecture, background vibe, and decorative aesthetic intact.
- Reference Images 2+ are the SOURCE MATERIAL images (${sourceCount} images provided).
  * MANDATORY MULTI-IMAGE COLLAGE: You MUST accurately feature ALL ${sourceCount} subjects in the layout as a cohesive multi-subject collage.
  * STRICTLY FORBIDDEN: Do NOT select only 1 source image. Every single provided source subject must appear simultaneously without horizontal stretching or facial distortion.
  * 繁體中文排版鐵律：上傳了共 ${sourceCount} 張素材圖片，必須全部拼貼融合進新圖，嚴禁只選用第 1 張素材！
` : '';

    const subjectFitRule = subjectFitMode === 'outpaint-fill'
      ? `3. CRITICAL: STRICT SUBJECT PROPORTION & OUTPAINTING RULE (左右擴圖填滿模式 - 防止橫向壓扁/拉寬):
   - STRICT FACIAL & ANATOMICAL RATIO LOCK: Absolutely preserve the native natural aspect ratio and facial bone structure of all human subjects from source images. Any horizontal stretching, squashing, or anamorphic distortion of faces, eyes, or bodies is STRICTLY FORBIDDEN.
   - When source subject width is narrower than the canvas, DO NOT stretch the subject horizontally. Instead, place the subject naturally on one side (or center) at original proportions and SEAMLESSLY EXTEND (Outpaint) the background environment horizontally to fill the canvas width.
   - 繁體中文排版規範：鎖死人臉與五官原生長寬比，嚴禁橫向拉寬變形。素材寬度不足時，主體以原比例置中或置側，背景向兩側無縫擴圖填滿。`
      : `3. CRITICAL: STRICT SUBJECT PROPORTION & CROPPING RULE (局部裁切特寫模式 - 防止橫向壓扁/拉寬):
   - STRICT FACIAL & ANATOMICAL RATIO LOCK: Absolutely preserve the native natural aspect ratio and facial bone structure of all human subjects from source images. Any horizontal stretching, squashing, or anamorphic distortion of faces, eyes, or bodies is STRICTLY FORBIDDEN.
   - Scale subject proportionally to fill composition, naturally cropping non-essential outer areas (e.g. lower torso, shoulders, or empty background edges) while keeping facial features crisp, true to original proportions, and distortion-free.
   - 繁體中文排版規範：鎖死人臉與五官原生長寬比，嚴禁橫向拉寬變形。等比例放大主體並局部裁切多餘邊緣，確保面部清晰端正立體。`;

    const backgroundRule = (keepSourceBackground !== false)
      ? `3. CRITICAL: STRICT SOURCE BACKGROUND PRESERVATION & SEAMLESS BLENDING (嚴格沿用素材背景，容許無縫融合):
   - You MUST directly preserve and use the original authentic background and environment from the source images.
   - It is STRICTLY FORBIDDEN to hallucinate, invent, or create a new unrelated background.
   - Seamless blending, edge feathering, and natural outpainting extension of the source images' original background are expressly permitted and encouraged so that all elements blend harmoniously without harsh seams or cut lines.
   - 繁體中文排版鐵律：絕對禁止模型為生成的新 OG 圖片自行創作不相干的新背景！但容許並鼓勵在生成圖片時將素材圖片的原生背景做無縫融合效果，邊緣自然羽化過渡，融為一體。`
      : '';

    promptText = `You are an expert Open Graph banner designer.
Your task is to create a new banner image based on the provided STYLE TEMPLATE and SOURCE IMAGES.

${templateInstruction}
RULES:
1. TEMPLATE FIDELITY & LAYOUT: Strictly follow the layout hierarchy, framing, visual balance, decorative accents, and color palette of the template image (Reference Image 1).
2. SOURCE PRESERVATION & COLLAGE: ${sourceCount > 1 ? `MANDATORY: You MUST include ALL ${sourceCount} source subjects in a harmonious multi-image collage layout. It is STRICTLY FORBIDDEN to use only the first source image.` : `Feature the source subject with high fidelity.`}
${subjectFitRule}
${backgroundRule}
4. LANGUAGE: The title and all text MUST be in Traditional Chinese (繁體中文).
5. TEXT PLACEMENT: Ensure text does not obstruct the main subject's face.
${logoRule}
${adBannerRules}

Title & Prompt:
${globalPrompt || '專業精緻宣傳橫幅'}

Layout Instructions (${ratio}):
${ratioPrompt || '標準排版'}
`.trim();
  }


  return generateAppImage({
    appModelId: modelId,
    prompt: promptText,
    referenceImages,
    ratio,
    quality: imageQuality,
    signal,
  });
}
