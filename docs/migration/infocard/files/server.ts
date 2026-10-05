import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import sharp from "sharp";
import { Converter } from "opencc-js";
import { handleImageRequest, type ImagePart } from "@hk01/pi-ai-extra-image-kit/server";
import { imageClient } from "./server/imageModels";

dotenv.config();

const serverToSimp = Converter({ from: 'hk', to: 'cn' });

export const toServerSimplified = (str: string | null | undefined): string => {
  if (!str) return '';
  try {
    return serverToSimp(str);
  } catch {
    return str;
  }
};

const app = express();
const PORT = 3000;

// Set up JSON body parser with increased limit for base64 images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 4K output sizes (batch edit offers 4K for these ratios). Other ratios fall back to their 2K size.
const DIMENSIONS_4K: Record<string, { width: number; height: number }> = {
  '4:5': { width: 3200, height: 4000 },
  '3:4': { width: 3072, height: 4096 },
  '1:1': { width: 4096, height: 4096 },
  '16:9': { width: 3840, height: 2160 },
  '9:16': { width: 2160, height: 3840 },
  '4:3': { width: 4096, height: 3072 },
};

// Standard target pixel dimensions
export const getTargetDimensions = (ratioId: string, resolution: string = '1K') => {
  const is2K = resolution === '2K' || resolution === '4K';
  if (resolution === '4K' && DIMENSIONS_4K[ratioId]) return DIMENSIONS_4K[ratioId];
  switch (ratioId) {
    case '4:5':
      return is2K ? { width: 2400, height: 3000 } : { width: 1200, height: 1500 };
    case '9:16':
      return is2K ? { width: 1350, height: 2400 } : { width: 675, height: 1200 };
    case '1:1':
      return is2K ? { width: 2400, height: 2400 } : { width: 1200, height: 1200 };
    case '3:4':
      return is2K ? { width: 2484, height: 3320 } : { width: 1242, height: 1660 };
    case '16:9':
      return is2K ? { width: 2400, height: 1350 } : { width: 1200, height: 675 };
    case '4:3':
      return is2K ? { width: 2400, height: 1800 } : { width: 1200, height: 900 };
    case '300x250':
      return is2K ? { width: 600, height: 500 } : { width: 300, height: 250 };
    case '300x300':
      return is2K ? { width: 600, height: 600 } : { width: 300, height: 300 };
    case '336x280':
      return is2K ? { width: 672, height: 560 } : { width: 336, height: 280 };
    case '300x600':
      return is2K ? { width: 600, height: 1200 } : { width: 300, height: 600 };
    case '320x480':
      return is2K ? { width: 640, height: 960 } : { width: 320, height: 480 };
    default:
      return is2K ? { width: 2400, height: 3000 } : { width: 1200, height: 1500 };
  }
};

// Normalize image dimensions to exact pixel perfection using sharp
export const normalizeImageDimensions = async (
  dataUrlOrUrl: string,
  ratioId: string,
  resolution: string = '1K'
): Promise<string> => {
  const { width, height } = getTargetDimensions(ratioId, resolution);
  return resizeImage(dataUrlOrUrl, width, height);
};

// Center-crop and resize an image to exact pixel dimensions using sharp
const resizeImage = async (dataUrlOrUrl: string, width: number, height: number): Promise<string> => {
  if (!dataUrlOrUrl) return dataUrlOrUrl;
  try {
    let inputBuffer: Buffer;
    let mimeType = 'image/jpeg';

    if (dataUrlOrUrl.startsWith('data:')) {
      const [header, data] = dataUrlOrUrl.split(',');
      mimeType = header.split(':')[1]?.split(';')[0] || 'image/jpeg';
      inputBuffer = Buffer.from(data, 'base64');
    } else if (dataUrlOrUrl.startsWith('http://') || dataUrlOrUrl.startsWith('https://')) {
      const res = await fetch(dataUrlOrUrl);
      if (!res.ok) return dataUrlOrUrl;
      inputBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      inputBuffer = Buffer.from(dataUrlOrUrl, 'base64');
    }

    const sharpInstance = sharp(inputBuffer).resize(width, height, {
      fit: 'cover',
      position: 'center',
      kernel: 'lanczos3',
    });

    if (mimeType.includes('png')) {
      const outBuf = await sharpInstance.png({ compressionLevel: 8 }).toBuffer();
      return `data:image/png;base64,${outBuf.toString('base64')}`;
    } else {
      const outBuf = await sharpInstance.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      return `data:image/jpeg;base64,${outBuf.toString('base64')}`;
    }
  } catch (err) {
    console.warn('Image dimension normalization warning:', err);
    return dataUrlOrUrl;
  }
};

// Helper to convert base64 data URL to an inline image part for @hk01/pi-ai-extra-image-kit
const getInlineData = (dataUrl: string) => {
  const [header, data] = dataUrl.split(',');
  const mimeType = header.split(':')[1].split(';')[0];
  return {
    inlineData: {
      data,
      mimeType,
    },
  };
};

// Image models offered by every image feature, with limits and key availability
app.get("/api/image-models", (_req, res) => {
  res.json({ models: imageClient.listModels() });
});

// Image proxy route to prevent canvas CORS contamination
app.get("/api/proxy-image", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send("Missing url parameter");
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/*, */*"
      }
    });
    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch remote image: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(buffer);
  } catch (err: any) {
    console.error("Proxy image error:", err);
    return res.status(500).send("Proxy image failed");
  }
});

app.post("/api/gemini/generate", async (req, res) => {
  try {
    const {
      templateImage,
      sourceImages,
      brandLogo,
      globalPrompt,
      ratioPrompt,
      ratio,
      modelId,
      eraseTemplateSubject = true,
      lockBrandLogo = true,
      // Sent only for models that accept it; the image kit rejects it for the others.
      temperature,
      aiMatting = false,
      forbidPretrainedKnowledge = true,
      imageResolution = '1K',
      language = 'tc',
    } = req.body;

    const targetRes = imageResolution === '2K' ? '2K' : '1K';
    const effectiveGlobalPrompt = language === 'sc' ? toServerSimplified(globalPrompt) : globalPrompt;
    const effectiveRatioPrompt = language === 'sc' ? toServerSimplified(ratioPrompt) : ratioPrompt;

    if (!templateImage) {
      return res.status(400).json({ error: "Missing templateImage" });
    }
    if (!sourceImages || !Array.isArray(sourceImages) || sourceImages.length === 0) {
      return res.status(400).json({ error: "Missing or empty sourceImages" });
    }

    const parts: ImagePart[] = [];

    // Add template image
    parts.push({ text: "STYLE TEMPLATE (Reference for layout, typography, colors, and overall vibe ONLY. CLEAN SLATE: Do NOT include any people, text, or specific objects from this reference style image in the final output):" });
    parts.push(getInlineData(templateImage));

    // Add source images
    parts.push({ text: "SOURCE IMAGES (CRITICAL: You MUST use these exact subjects. Do NOT modify their faces, expressions, features, or identities. 100% pixel-perfect preservation of the subjects is required. CRITICAL: PRESERVE ASPECT RATIO - do not stretch or squash these subjects, use cropping or background filling if needed):" });
    sourceImages.forEach((img: string, idx: number) => {
      parts.push({ text: `Source Image 第${idx + 1}張:` });
      parts.push(getInlineData(img));
    });

    // Add brand logo if exists
    if (brandLogo) {
      parts.push({ text: "BRAND LOGO (CRITICAL: 100% pixel-perfect copy of this logo. Place it in the top left or top right corner as appropriate for the layout):" });
      parts.push(getInlineData(brandLogo));
    } else {
      parts.push({ text: "BRAND LOGO: If there is a logo in the style template (usually top right or top left), 100% pixel-perfect copy it to the new image." });
    }

    // Add text prompts
    const isAdBanner = ['300x250', '300x300', '336x280', '300x600', '320x480'].includes(ratio);
    const adBannerRules = isAdBanner ? `
7. CRITICAL DISPLAY AD BANNER SAFE ZONE (${ratio}):
   - This output is a display ad banner (${ratio}).
   - You MUST keep ALL text (titles, subtitles, tags) and logos strictly within the central 80% safe region.
   - Leave sufficient empty safety margins on outer edges so no text or logo is placed near or cut off by the border.
   - Wrap long text titles neatly into shorter lines to stay within the safe region.
` : '';

    const templateCleanSlateRule = eraseTemplateSubject
      ? "1. CLEAN SLATE & SUBJECT ERASURE: You MUST completely remove and erase any people, characters, actors, faces, or specific main subjects from the Style Template image. The template image is ONLY for layout geometry, typography, color scheme, and background atmosphere. Do NOT include any subjects from the style template image. Place ONLY the subjects from the provided SOURCE IMAGES."
      : "1. STYLE TEMPLATE BLENDING: You may preserve, blend, or adapt subjects from the style template together with the source images as requested.";

    const logoLockRule = lockBrandLogo
      ? "6. BRAND LOGO LOCK: You MUST 100% pixel-perfect copy and lock the Brand Logo (from the brand logo image or top corner of the style template). Maintain exact shape, color, aspect ratio, typography, and borders without any AI distortion, redrawing, or modification. Place cleanly in top-left or top-right corner."
      : "6. BRAND LOGO: Ensure the brand logo is placed in the top left or top right.";

    const mattingRule = aiMatting
      ? "2. AI SUBJECT EXTRACTION & BACKGROUND REMOVAL (智能退地/摳圖): You MUST automatically isolate, extract, and cutout the main subjects/people/products from the SOURCE IMAGES, completely stripping away their original backgrounds, and seamlessly place ONLY the extracted main subjects into the template background without any of their original image backgrounds."
      : "2. SOURCE PRESERVATION: You MUST use the provided SOURCE IMAGES. Do NOT modify their faces, expressions, features, or identities. 100% pixel-perfect preservation of the subjects is required.";

    const forbidPretrainedRule = forbidPretrainedKnowledge
      ? "7. FORBID PRETRAINED KNOWLEDGE (禁止使用預訓練數據庫): You are STRICTLY FORBIDDEN from searching, recalling, or generating any brand logos, fonts, or assets from your internal AI pretrained knowledge base. You MUST ONLY rely on the user-provided Brand Logo image or style template image. If no logo image is supplied, DO NOT draw or synthesize any brand logo from memory."
      : "7. PRETRAINED KNOWLEDGE ALLOWED: You may use internal pretrained knowledge about the brand to assist in drawing or reconstructing the logo if no reference image is provided.";

    const fullPrompt = `
You are an expert Open Graph image creator and collage master.
Your task is to create a new Open Graph image based on the provided STYLE TEMPLATE and SOURCE IMAGES.

CRITICAL RULES:
${templateCleanSlateRule}
${mattingRule}
3. CRITICAL: PRESERVE ASPECT RATIO. Do not stretch or squash the subjects. Use cropping or background filling if the aspect ratio doesn't match perfectly.
4. TEXT PLACEMENT: Ensure the text title does NOT obscure the main subjects (especially faces) or important objects.
5. LANGUAGE: The title and all text MUST strictly be in ${language === 'sc' ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).' }
${logoLockRule}
${forbidPretrainedRule}
${adBannerRules}
Global Instructions & Title:
${effectiveGlobalPrompt}

Specific Layout Instructions for this ratio (${ratio}):
${effectiveRatioPrompt}
`;

    parts.push({ text: fullPrompt });

    await handleImageRequest(
      res,
      imageClient,
      { appModelId: modelId, parts, aspectRatio: ratio, resolution: targetRes, temperature },
      async (image) => ({ imageUrl: await normalizeImageDimensions(image.dataUrl, ratio, targetRes) }),
    );
  } catch (error: any) {
    console.error("Error in generate API:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message || "Unknown server error occurred" });
  }
});

// API Endpoint for editing OG image (DeepEditor in the OG, InfoCard and possession tabs)
app.post("/api/gemini/edit", async (req, res) => {
  try {
    const {
      baseImage,
      editPrompt,
      modelId,
      language = 'tc',
    } = req.body;

    if (!baseImage) {
      return res.status(400).json({ error: "Missing baseImage" });
    }
    if (!editPrompt) {
      return res.status(400).json({ error: "Missing editPrompt" });
    }

    const effectiveEditPrompt = language === 'sc' ? toServerSimplified(editPrompt) : editPrompt;
    // The edit keeps the original image's aspect ratio and pixel size.
    const baseSize = await getImageSize(baseImage);
    if (!baseSize) {
      return res.status(400).json({ error: "無法讀取原圖的尺寸，請重新載入圖片後再試。" });
    }

    const parts: ImagePart[] = [];

    parts.push({ text: "ORIGINAL IMAGE TO EDIT:" });
    parts.push(await ensureInlineData(baseImage));

    const fullPrompt = `
You are an expert image editor. Your task is to apply the requested edits to the provided image.
CRITICAL RULES:
1. PRESERVE UNMARKED AREAS: Do not change any part of the image that is not explicitly mentioned in the edit instructions.
2. REMOVE STROKES: The provided image may have colored strokes or circles indicating where to edit. You MUST remove these strokes and replace them with the requested content or blend them naturally into the background.
3. FOLLOW INSTRUCTIONS: Apply the edits exactly as requested in the instructions below.
4. PRESERVE ASPECT RATIO: The output image MUST have the exact same aspect ratio as the original image. Do not crop it to a square unless the original is a square.
5. LANGUAGE: If any text or titles are added or altered, they MUST strictly be in ${language === 'sc' ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).' }

Edit Instructions:
${effectiveEditPrompt}
`;

    parts.push({ text: fullPrompt });

    await handleImageRequest(
      res,
      imageClient,
      {
        appModelId: modelId,
        parts,
        aspectRatio: `${baseSize.width}:${baseSize.height}`,
        keepInputAspect: true,
        resolution: '2K',
      },
      async (image) => ({ imageUrl: await resizeImage(image.dataUrl, baseSize.width, baseSize.height) }),
    );
  } catch (error: any) {
    console.error("Error in edit API:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message || "Unknown server error occurred" });
  }
});

// Helper for extracting clean text from HTML
const extractTextFromHtml = (html: string): { title: string; content: string } => {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Remove scripts, styles, noscript, svg, header, nav, footer, etc.
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Extract paragraphs or main text
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  // Decode HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize whitespace
  const content = cleaned.replace(/\s+/g, ' ').trim();
  return { title, content: content.slice(0, 15000) };
};

// API Endpoint for InfoCard: Article Extraction and AI Hook Titles/Card Distillation
app.post("/api/infocard/analyze-article", async (req, res) => {
  try {
    const {
      url,
      rawText,
      textModel = 'gemini-3.8-flash',
      maxTitleChars = { main: 13, sub: 13, minor: 13 },
      wordsPerCard = 80,
      targetCardCount = 5,
      autoDetectCardCount = true,
      language = 'tc',
    } = req.body;

    const isSimp = language === 'sc';

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY 未配置在伺服器端。" });
    }

    let articleTitle = '';
    let articleContent = rawText ? String(rawText).trim() : '';

    if (url && typeof url === 'string' && url.startsWith('http')) {
      try {
        const fetchRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-HK,zh-TW,zh;q=0.9,en;q=0.8"
          }
        });
        if (fetchRes.ok) {
          const html = await fetchRes.text();
          const extracted = extractTextFromHtml(html);
          articleTitle = extracted.title;
          if (!articleContent) {
            articleContent = extracted.content;
          }
        }
      } catch (err: any) {
        console.warn("Fetch article URL warning:", err);
      }
    }

    if (!articleContent && !articleTitle) {
      return res.status(400).json({ error: "無法從提供的網址或文字中擷取到文章內容，請直接貼上文章內文。" });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const chosenTextModel = textModel === 'gemini-3.5-flash-lite' || textModel === 'gemini-3.1-flash-lite' 
      ? 'gemini-3.5-flash-lite' 
      : 'gemini-3.8-flash';

    const prompt = isSimp ? `
你是一位顶级社交媒体「资讯图卡（InfoCard）爆款传播专家」与新闻总编辑。
你的任务是将以下文章转化为极具社交传播力（点赞、留言、分享、关注）的多张简体中文资讯图卡组合。

【文章标题】：${articleTitle}
【文章内容】：
${articleContent.slice(0, 8000)}

【字数、张数与标签规范】：
1. 封面首图标题字数严格限制：
   - 大标题（mainTitle）：绝对不能超过 ${maxTitleChars.main || 13} 个简体中文字
   - 中标题（subTitle）：绝对不能超过 ${maxTitleChars.sub || 13} 个简体中文字
   - 小标题（minorTitle）：绝对不能超过 ${maxTitleChars.minor || 13} 个简体中文字
2. 内容图卡（Content Cards）与张数决定：
   - 每张内容图卡上的文字段落（bodyParagraph）：提炼为约 ${wordsPerCard || 80} 字左右的精华金句或重点摘要（用图片讲故事，读者一眼看懂）。
   - 图卡张数自动决定：${autoDetectCardCount ? '【完全自主决定张数】请根据文章长度、段落逻辑与重点丰富度，自主决定最适内容图卡张数（通常为 3 至 8 张，最多可达 12 张），确保涵盖文章关键精华。' : `请固定制作 ${targetCardCount || 5} 张内容图卡`}。
3. 【#标签 Tag 文字】：模型拥有完全自主创作与填充权限！请根据文章核心主旨与热门社交标签趋势，为封面首图与每张内容图卡自行创作 2-4 个极具吸引力的简体中文 #Hashtags（例如 #时事分析 #重点速览 #必读指南）。
4. 语言规范：所有输出的标题、副标题、小标题、正文段落与 #Hashtags 必须严格使用简体中文（简体字），严禁使用繁体字。

【输出要求（纯 JSON 格式）】：
1. titleSets: 生成 5 套极具社交爆款点击力、能在 2 秒内抓住读者眼球的标题组合（每套包含 id, mainTitle, subTitle, minorTitle, tags）。
2. recommendedIndex: 0 到 4 之间，由你推荐最好、最具传播爆发力的一套标题索引。
3. coverTags: 为封面首图自行创作的 2-4 个高流量简体中文标签字串 (例如 "#时事焦点 #重点速览 #必读指南")。
4. extractedArticle: 整理后的文章标题 (title) 与干净摘要全文 (content)。
5. contentCardsBreakdown: 数组，每张图卡包含：
   - cardIndex: 序号 (1, 2, 3...)
   - subTitle: 该张卡片的中标题（10-14字）
   - minorTitle: 该张卡片的小标题或关键标签（5-10字）
   - bodyParagraph: 该张卡片的精华文字段落（约 ${wordsPerCard || 80} 字）
   - imagePrompt: 适合该张图卡视觉主体的英文提示词（用于生图引导，描述主要画面主体与氛围）
   - tags: 模型为该张图卡重点自行创作的 2-3 个简体中文 #Hashtags (例如 "#重点整理 #核心关键")

请只输出符合以下 JSON Schema 的合法 JSON 物件，不要包裹 markdown 或其他字元：
{
  "extractedArticle": {
    "title": "...",
    "content": "..."
  },
  "coverTags": "#时事焦点 #重点速览 #必读指南",
  "titleSets": [
    {
      "id": "set-1",
      "mainTitle": "...",
      "subTitle": "...",
      "minorTitle": "...",
      "tags": "#时事焦点 #热门话题"
    }
  ],
  "recommendedIndex": 0,
  "contentCardsBreakdown": [
    {
      "cardIndex": 1,
      "subTitle": "...",
      "minorTitle": "...",
      "bodyParagraph": "...",
      "imagePrompt": "...",
      "tags": "#重点解析 #核心关键"
    }
  ]
}
` : `
你是一位頂級社交媒體「資訊圖卡（InfoCard）爆款傳播專家」與新聞總編輯。
你的任務是將以下文章轉化為極具社交傳播力（點讚、留言、分享、追蹤）的多張繁體中文資訊圖卡組合。

【文章標題】：${articleTitle}
【文章內容】：
${articleContent.slice(0, 8000)}

【字數、張數與標籤規範】：
1. 封面首圖標題字數嚴格限制：
   - 大標題（mainTitle）：絕對不能超過 ${maxTitleChars.main || 13} 個繁體中文字
   - 中標題（subTitle）：絕對不能超過 ${maxTitleChars.sub || 13} 個繁體中文字
   - 小標題（minorTitle）：絕對不能超過 ${maxTitleChars.minor || 13} 個繁體中文字
2. 內容圖卡（Content Cards）與張數決定：
   - 每張內容圖卡上的文字段落（bodyParagraph）：提煉為約 ${wordsPerCard || 80} 字左右的精華金句或重點摘要（用圖片講故事，讀者一眼看懂）。
   - 圖卡張數自動決定：${autoDetectCardCount ? '【完全自主決定張數】請根據文章長度、段落邏輯與重點豐富度，自主決定最適內容圖卡張數（通常為 3 至 8 張，最多可達 12 張），確保涵蓋文章關鍵精華。' : `請固定製作 ${targetCardCount || 5} 張內容圖卡`}。
3. 【#標籤 Tag 文字】：模型擁有完全自主創作與填充權限！請根據文章核心主旨與熱門社交標籤趨勢，為封面首圖與每張內容圖卡自行創作 2-4 個極具吸引力的繁體中文 #Hashtags（例如 #時事分析 #重點懶人包 #必讀指南）。

【輸出要求（純 JSON 格式）】：
1. titleSets: 生成 5 套極具社交爆款點擊力、能在 2 秒內抓住讀者眼球的標題組合（每套包含 id, mainTitle, subTitle, minorTitle, tags）。
2. recommendedIndex: 0 到 4 之間，由你推薦最好、最具傳播爆發力的一套標題索引。
3. coverTags: 為封面首圖自行創作的 2-4 個高流量繁體中文標籤字串 (例如 "#時事焦點 #重點懶人包 #必讀指南")。
4. extractedArticle: 整理後的文章標題 (title) 與乾淨摘要全文 (content)。
5. contentCardsBreakdown: 陣列，每張圖卡包含：
   - cardIndex: 序號 (1, 2, 3...)
   - subTitle: 該張卡片的中標題（10-14字）
   - minorTitle: 該張卡片的小標題或關鍵標籤（5-10字）
   - bodyParagraph: 該張卡片的精華文字段落（約 ${wordsPerCard || 80} 字）
   - imagePrompt: 適合該張圖卡視覺主體的英文提示詞（用於生圖引導，描述主要畫面主體與氛圍）
   - tags: 模型為該張圖卡重點自行創作的 2-3 個繁體中文 #Hashtags (例如 "#重點整理 #核心關鍵")

請只輸出符合以下 JSON Schema 的合法 JSON 物件，不要包裹 markdown 或其他字元：
{
  "extractedArticle": {
    "title": "...",
    "content": "..."
  },
  "coverTags": "#時事焦點 #重點懶人包 #必讀指南",
  "titleSets": [
    {
      "id": "set-1",
      "mainTitle": "...",
      "subTitle": "...",
      "minorTitle": "...",
      "tags": "#時事焦點 #熱門話題"
    }
  ],
  "recommendedIndex": 0,
  "contentCardsBreakdown": [
    {
      "cardIndex": 1,
      "subTitle": "...",
      "minorTitle": "...",
      "bodyParagraph": "...",
      "imagePrompt": "...",
      "tags": "#重點解析 #核心關鍵"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: chosenTextModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.6,
      }
    });

    const textOutput = response.text || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(textOutput);
    } catch (e) {
      // Clean up markdown block if present
      const cleanedJson = textOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanedJson);
    }

    if (isSimp && parsed) {
      if (parsed.extractedArticle) {
        parsed.extractedArticle.title = toServerSimplified(parsed.extractedArticle.title);
        parsed.extractedArticle.content = toServerSimplified(parsed.extractedArticle.content);
      }
      if (parsed.coverTags) {
        parsed.coverTags = toServerSimplified(parsed.coverTags);
      }
      if (Array.isArray(parsed.titleSets)) {
        parsed.titleSets = parsed.titleSets.map((ts: any) => ({
          ...ts,
          mainTitle: toServerSimplified(ts.mainTitle),
          subTitle: toServerSimplified(ts.subTitle),
          minorTitle: toServerSimplified(ts.minorTitle),
          tags: toServerSimplified(ts.tags),
        }));
      }
      if (Array.isArray(parsed.contentCardsBreakdown)) {
        parsed.contentCardsBreakdown = parsed.contentCardsBreakdown.map((cb: any) => ({
          ...cb,
          subTitle: toServerSimplified(cb.subTitle),
          minorTitle: toServerSimplified(cb.minorTitle),
          bodyParagraph: toServerSimplified(cb.bodyParagraph),
          tags: toServerSimplified(cb.tags),
        }));
      }
    }

    return res.json(parsed);
  } catch (error: any) {
    console.error("Error in analyze-article API:", error);
    res.status(500).json({ error: error.message || "文章解析與圖卡規劃失敗" });
  }
});

// API Endpoint for InfoCard: Single Card Image Generation
app.post("/api/infocard/generate-card", async (req, res) => {
  try {
    const {
      cardType = 'cover',
      cardIndex = 1,
      templateImage,
      sourceImages = [],
      imagePrompt = '',
      brandLogo = null,
      mainTitle = '',
      subTitle = '',
      minorTitle = '',
      bodyParagraph = '',
      tags = '',
      eraseTemplateText = true,
      lockBrandLogo = true,
      forbidPretrainedLogo = true,
      forbidHallucinatedText = true,
      ratio = '4:5',
      resolution = '1K',
      modelId = 'nano-banana-2',
      language = 'tc',
    } = req.body;

    const isSimp = language === 'sc';
    const effectiveMainTitle = isSimp ? toServerSimplified(mainTitle) : mainTitle;
    const effectiveSubTitle = isSimp ? toServerSimplified(subTitle) : subTitle;
    const effectiveMinorTitle = isSimp ? toServerSimplified(minorTitle) : minorTitle;
    const effectiveBody = isSimp ? toServerSimplified(bodyParagraph) : bodyParagraph;
    const effectiveTags = isSimp ? toServerSimplified(tags) : tags;

    if (!templateImage) {
      return res.status(400).json({ error: "請提供樣板圖片以供風格參考" });
    }

    const parts: ImagePart[] = [];

    // 1. Reference Style Template Image
    parts.push({
      text: `REFERENCE STYLE TEMPLATE (${cardType === 'cover' ? 'COVER HEADLINE STYLE' : 'CONTENT INFOCARD STYLE'}):
You must 100% replicate the aesthetic, typography styling, color theme, artistic atmosphere, badge shapes, and background layout from this reference template image.
${eraseTemplateText ? 'CRITICAL: ERASE ORIGINAL TEXT: Completely remove and wipe away all original text, titles, numbers, and captions from this style template. Replace them with the NEW specified text below using the exact same font weight, color palette, and layout aesthetic.' : ''}`
    });
    parts.push(getInlineData(templateImage));

    // 2. Source Images if provided
    if (sourceImages && Array.isArray(sourceImages) && sourceImages.length > 0) {
      parts.push({
        text: "NEW USER SOURCE IMAGES (CRITICAL: Seamlessly blend and integrate these new subject images into the layout):"
      });
      sourceImages.forEach((img: string, idx: number) => {
        parts.push({ text: `Source Image #${idx + 1}:` });
        parts.push(getInlineData(img));
      });
    }

    // 3. Brand Logo
    if (brandLogo) {
      parts.push({
        text: "BRAND LOGO (CRITICAL: 100% pixel-perfect reproduction of this brand logo. Position cleanly at top-left or top-right corner according to the template):"
      });
      parts.push(getInlineData(brandLogo));
    } else if (lockBrandLogo) {
      parts.push({
        text: "BRAND LOGO PRESERVATION: If there is a brand logo or watermarked badge in the reference template image (usually top-left or top-right), 100% pixel-perfect copy it to the new image without distortion."
      });
    }

    // 4. Detailed Instructions & Guardrails
    const isReel916 = ratio === '9:16';
    const reelsSafeZoneInstruction = isReel916 ? `
CRITICAL META / INSTAGRAM REELS SAFE ZONE GUIDELINES (9:16 Aspect Ratio):
- Keep the top 15% (header area) and bottom 20% (caption/interaction UI area) completely free of critical text, logos, or primary faces.
- Place all main titles, subtitles, body paragraphs, and key visual subjects strictly within the central 65% safe canvas area so they are not covered by Instagram Reels / Stories UI overlay buttons.
` : '';

    const logoNegativePrompt = forbidPretrainedLogo ? `
NEGATIVE PROMPT (FORBID PRETRAINED LOGOS):
- STRICTLY FORBIDDEN from generating, creating, or recalling any random company/brand logos, watermarks, or emblems from pre-trained knowledge base. ONLY reproduce the logo provided in the template or user logo image. If none exists, leave the corner clean without inventing a fake logo.
` : '';

    const textNegativePrompt = forbidHallucinatedText ? `
NEGATIVE PROMPT (FORBID HALLUCINATED TEXT & ARTIFACTS):
- STRICTLY FORBIDDEN from inventing random nonsense gibberish, illegible Latin text, or fabricated paragraphs.
- Render ONLY the exact ${isSimp ? 'Simplified Chinese (简体中文)' : 'Traditional Chinese (繁體中文)'} titles, subtitles, and paragraphs explicitly supplied in the instructions below.
` : '';

    const subjectGuidance = (sourceImages && sourceImages.length > 0)
      ? "Use the provided source images as the visual subject."
      : (imagePrompt && imagePrompt.trim())
        ? `Generate the visual subject following this image prompt: "${imagePrompt}"`
        : `Automatically understand the card's topic ("${effectiveMainTitle || effectiveSubTitle || effectiveBody}") and synthesize a highly relevant, visually stunning focal subject and background that matches the style template.`;

    const fullInstruction = `
You are an expert Social Media InfoCard graphic designer and art director.
Generate a high-converting, viral social media InfoCard image in ${isSimp ? 'Simplified Chinese (简体中文)' : 'Traditional Chinese (繁體中文)'}.

CARD TYPE: ${cardType === 'cover' ? '【封面首圖 (Cover Hook Card)】- Designed to stop scrolling within 2 seconds' : `【內容圖卡 (Content Card #${cardIndex})】- High-retention informative infographic`}

TEXT & TYPOGRAPHY TO RENDER (Match template font style, colors, shadows, and hierarchy):
${effectiveMainTitle ? `- 大標題 (Main Title): "${effectiveMainTitle}"` : ''}
${effectiveSubTitle ? `- 中標題 (Subtitle): "${effectiveSubTitle}"` : ''}
${effectiveMinorTitle ? `- 小標題 (Minor Title / Hook): "${effectiveMinorTitle}"` : ''}
${effectiveBody ? `- 內容段落 (Body Paragraph): "${effectiveBody}"` : ''}
${effectiveTags ? `- 標籤 (Tags / Badges): "${effectiveTags}"` : ''}

VISUAL SUBJECT & COMPOSITION:
${subjectGuidance}

COMPOSITION RULES:
1. CHINESE LANGUAGE ONLY: All rendered text MUST be accurate, legible ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体字。' : 'Traditional Chinese (繁體中文).' }
2. CONTRAST & LEGIBILITY: Ensure text has clear contrast against background cards/overlays.
3. ARTISTIC ALIGNMENT: Perfectly mimic the color palette, card borders, icons, and lighting from the REFERENCE STYLE TEMPLATE.
${reelsSafeZoneInstruction}
${logoNegativePrompt}
${textNegativePrompt}
`;

    parts.push({ text: fullInstruction });

    const targetRes = resolution === '2K' ? '2K' : '1K';
    await handleImageRequest(
      res,
      imageClient,
      { appModelId: modelId, parts, aspectRatio: ratio, resolution: targetRes },
      async (image) => ({ imageUrl: await normalizeImageDimensions(image.dataUrl, ratio, targetRes) }),
    );
  } catch (error: any) {
    console.error("Error in generate-card API:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message || "圖卡生成失敗" });
  }
});

// Helper to safely obtain buffer from base64 or URL
const getBufferFromUrlOrDataUrl = async (dataUrlOrUrl: string): Promise<Buffer> => {
  if (dataUrlOrUrl.startsWith('data:')) {
    const [, data] = dataUrlOrUrl.split(',');
    return Buffer.from(data, 'base64');
  } else if (dataUrlOrUrl.startsWith('http://') || dataUrlOrUrl.startsWith('https://')) {
    const res = await fetch(dataUrlOrUrl);
    if (!res.ok) throw new Error(`無法載入遠端圖片: ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  } else {
    return Buffer.from(dataUrlOrUrl, 'base64');
  }
};

// Helper to ensure base64 inlineData part for Gemini
const ensureInlineData = async (dataUrlOrUrl: string) => {
  if (dataUrlOrUrl.startsWith('data:')) {
    return getInlineData(dataUrlOrUrl);
  }
  const buf = await getBufferFromUrlOrDataUrl(dataUrlOrUrl);
  return {
    inlineData: {
      data: buf.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };
};

// Pixel size of an image as displayed (EXIF rotation applied), or null when it cannot be read
const getImageSize = async (dataUrlOrUrl: string): Promise<{ width: number; height: number } | null> => {
  try {
    const metadata = await sharp(await getBufferFromUrlOrDataUrl(dataUrlOrUrl)).metadata();
    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    return width && height ? { width, height } : null;
  } catch (err) {
    console.warn('Image size read warning:', err);
    return null;
  }
};

// Applies EXIF rotation, so the pixels sent to the model match what the user saw (and drew masks on).
// An image sharp cannot read is returned unchanged; the later checks reject it with a clear message.
const getUprightImage = async (dataUrlOrUrl: string): Promise<string> => {
  try {
    const input = await getBufferFromUrlOrDataUrl(dataUrlOrUrl);
    const metadata = await sharp(input).metadata();
    if (!metadata.orientation || metadata.orientation === 1) return dataUrlOrUrl;
    const rotated = sharp(input).rotate();
    const output = metadata.hasAlpha ? await rotated.png().toBuffer() : await rotated.jpeg({ quality: 95 }).toBuffer();
    return `data:image/${metadata.hasAlpha ? 'png' : 'jpeg'};base64,${output.toString('base64')}`;
  } catch (err) {
    console.warn('Image orientation warning:', err);
    return dataUrlOrUrl;
  }
};

// Center-crops an image to the aspect of width:height, keeping its own resolution
const cropToAspect = async (dataUrl: string, width: number, height: number): Promise<string> => {
  const size = await getImageSize(dataUrl);
  if (!size) return dataUrl;
  const target = width / height;
  const cropped = size.width / size.height > target
    ? { width: Math.round(size.height * target), height: size.height }
    : { width: size.width, height: Math.round(size.width / target) };
  if (cropped.width === size.width && cropped.height === size.height) return dataUrl;
  return resizeImage(dataUrl, cropped.width, cropped.height);
};

// Helper: Stamp logo on image using Sharp with exact positioning and opacity
const stampLogoOnImage = async (
  baseImageDataUrl: string,
  logoConfig: {
    logoUrl: string;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    scale: number; // 5 to 35%
    opacity: number; // 20 to 100%
  }
): Promise<string> => {
  try {
    const baseBuffer = await getBufferFromUrlOrDataUrl(baseImageDataUrl);
    const logoBuffer = await getBufferFromUrlOrDataUrl(logoConfig.logoUrl);

    const baseMeta = await sharp(baseBuffer).metadata();
    const baseWidth = baseMeta.width || 1200;
    const baseHeight = baseMeta.height || 1200;

    const targetLogoWidth = Math.max(20, Math.round(baseWidth * (logoConfig.scale / 100)));

    let processedLogo = sharp(logoBuffer).resize(targetLogoWidth, undefined, {
      fit: 'inside',
    });

    if (logoConfig.opacity < 100) {
      processedLogo = processedLogo.composite([{
        input: Buffer.from([255, 255, 255, Math.round(255 * (logoConfig.opacity / 100))]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      }]);
    }

    const resizedLogoBuf = await processedLogo.png().toBuffer();
    const logoMeta = await sharp(resizedLogoBuf).metadata();
    const logoW = logoMeta.width || targetLogoWidth;
    const logoH = logoMeta.height || targetLogoWidth;

    const marginX = Math.round(baseWidth * 0.04);
    const marginY = Math.round(baseHeight * 0.04);

    let left = marginX;
    let top = marginY;

    if (logoConfig.position === 'top-right') {
      left = baseWidth - logoW - marginX;
      top = marginY;
    } else if (logoConfig.position === 'bottom-left') {
      left = marginX;
      top = baseHeight - logoH - marginY;
    } else if (logoConfig.position === 'bottom-right') {
      left = baseWidth - logoW - marginX;
      top = baseHeight - logoH - marginY;
    } else if (logoConfig.position === 'center') {
      left = Math.round((baseWidth - logoW) / 2);
      top = Math.round((baseHeight - logoH) / 2);
    }

    const stampedBuffer = await sharp(baseBuffer)
      .composite([{
        input: resizedLogoBuf,
        top: Math.max(0, top),
        left: Math.max(0, left),
      }])
      .jpeg({ quality: 95 })
      .toBuffer();

    return `data:image/jpeg;base64,${stampedBuffer.toString('base64')}`;
  } catch (err) {
    console.error('Logo stamp failed:', err);
    return baseImageDataUrl;
  }
};

// ==========================================
// OG 奪舍 (OG Metamorphosis) Suite APIs
// ==========================================

// 1. 大模型自動提取所有文字標題與素材特徵 (LLM Headline Extraction & Feature Analysis)
app.post("/api/possession/extract-material", async (req, res) => {
  try {
    const { materialImage, textModel = 'gemini-3.8-flash', language = 'tc' } = req.body;

    if (!materialImage || typeof materialImage !== 'string') {
      return res.status(400).json({ error: "請上傳新圖片素材以供解析" });
    }

    const isSimp = language === 'sc';

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY 未配置在伺服器端。" });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const chosenModel = textModel === 'gemini-3.1-flash-lite' ? 'gemini-3.1-flash-lite' : 'gemini-3.8-flash';
    const inlineMaterial = await ensureInlineData(materialImage);

    const extractionPrompt = isSimp ? `
你是一位顶尖的社交新闻总编与多模态视觉鉴赏专家。
请深入分析这张使用者上传的新图片素材（素材图），完成以下四项核心任务：

1. 【核心主标题 (Main Title)】：自动识别画面最核心大标题或核心主题，必须符合简体中文规范，精炼有力（约 8-16 字），直接切中画面焦点。
2. 【副标题与亮点标签 (Subtitles & Badges)】：提取画面中的次要说明字、活动资讯、价格标签、优惠亮点或关键修饰词，拆分为副标题 (subtitle) 及 2-5 个亮点标签 (badges，例如 "新品上市", "限定优惠", "评测首发")。
3. 【完整检测文字清单 (detectedTextList)】：客观列出原图上识别到的所有繁体/简体/英文等字词短语。
4. 【像素级主体特征锁定分析】：
   - 人物容貌特征 (characters)：描述主角面部表情、眼神注视方向、五官特征、发型发色与身体姿态。若无人物则注明「纯产品/物件」。
   - 核心产品与道具 (products)：精确识别画面中的核心商品、手机型号、外观轮廓、材质反光与关键道具。
   - 视觉基调 (lightingVibe)：分析原生光影氛围、色温倾向（如暖调自然光、冷调影棚光、高对比轮廓光）。

【重要风格与语言规范】：
- 绝对禁止赛博朋克（Cyberpunk）风格。
- 所有输出文字一律严格使用标准「简体中文」（Simplified Chinese），严禁使用繁体字。

请只输出合法 JSON，格式如下：
{
  "mainTitle": "核心主标题文字",
  "subtitle": "副标题或重点补充说明",
  "badges": ["标签一", "标签二", "标签三"],
  "detectedTextList": ["原图文字1", "原图文字2"],
  "characters": "人物容貌、五官细节与姿态特征描述",
  "products": "核心产品、型号轮廓与材质反光细节",
  "lightingVibe": "原生光影与色彩氛围"
}
` : `
你是一位頂尖的社交新聞總編與多模態視覺鑑賞專家。
請深入分析這張使用者上載的新圖片素材（素材圖），完成以下四項核心任務：

1. 【核心主標題 (Main Title)】：自動識別畫面最核心大標題或核心主題，必須符合繁體中文（港台規範），精練有力（約 8-16 字），直接切中畫面焦點。
2. 【副標題與亮點標籤 (Subtitles & Badges)】：提取畫面中的次要說明字、活動資訊、價格標籤、優惠亮點或關鍵修飾詞，拆分為副標題 (subtitle) 及 2-5 個亮點標籤 (badges，例如 "新品上市", "限定優惠", "評測首發")。
3. 【完整檢測文字清單 (detectedTextList)】：客觀列出原圖上識別到的所有繁體/簡體/英文等字詞短語。
4. 【像素級主體特徵鎖定分析】：
   - 人物容貌特徵 (characters)：描述主角面部表情、眼神注視方向、五官特徵、髮型髮色與身體姿態。若無人物則註明「純產品/物件」。
   - 核心產品與道具 (products)：精確識別畫面中的核心商品、手機型號、外觀輪廓、材質反光與關鍵道具。
   - 視覺基調 (lightingVibe)：分析原生光影氛圍、色溫傾向（如暖調自然光、冷調影棚光、高對比輪廓光）。

【重要風格規範】：
- 絕對禁止賽博朋克（Cyberpunk）風格。
- 所有文字一律使用道地標準的「繁體中文」（Traditional Chinese）。

請只輸出合法 JSON，格式如下：
{
  "mainTitle": "核心主標題文字",
  "subtitle": "副標題或重點補充說明",
  "badges": ["標籤一", "標籤二", "標籤三"],
  "detectedTextList": ["原圖文字1", "原圖文字2"],
  "characters": "人物容貌、五官細節與姿態特徵描述",
  "products": "核心產品、型號輪廓與材質反光細節",
  "lightingVibe": "原生光影與色彩氛圍"
}
`;

    const response = await ai.models.generateContent({
      model: chosenModel,
      contents: {
        parts: [
          inlineMaterial,
          { text: extractionPrompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      }
    });

    const rawText = response.text || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    const finalMainTitle = isSimp ? toServerSimplified(parsed.mainTitle) : (parsed.mainTitle || "熱門焦點推薦");
    const finalSubtitle = isSimp ? toServerSimplified(parsed.subtitle) : (parsed.subtitle || "");
    const finalBadges = Array.isArray(parsed.badges) 
      ? (isSimp ? parsed.badges.map((b: string) => toServerSimplified(b)) : parsed.badges)
      : [];
    const finalDetected = Array.isArray(parsed.detectedTextList)
      ? (isSimp ? parsed.detectedTextList.map((t: string) => toServerSimplified(t)) : parsed.detectedTextList)
      : [];
    const finalCharacters = isSimp ? toServerSimplified(parsed.characters) : (parsed.characters || "人物主體自然表情與五官特徵");
    const finalProducts = isSimp ? toServerSimplified(parsed.products) : (parsed.products || "核心物件與產品質感");
    const finalLighting = isSimp ? toServerSimplified(parsed.lightingVibe) : (parsed.lightingVibe || "柔和環境光");

    return res.json({
      mainTitle: finalMainTitle,
      subtitle: finalSubtitle,
      badges: finalBadges,
      detectedTextList: finalDetected,
      characters: finalCharacters,
      products: finalProducts,
      lightingVibe: finalLighting,
    });

  } catch (error: any) {
    console.error("Error in extract-material API:", error);
    res.status(500).json({ error: error.message || "素材文字與特徵提取失敗" });
  }
});

// 2. 按照「參考樣板圖」風格生成 OG 圖 (OG Metamorphosis Generation)
app.post("/api/possession/generate", async (req, res) => {
  try {
    const {
      templateImage,
      materialImage,
      brandLogo = null,
      lockBrandLogo = true,
      lockFacialIdentity = true,
      lockProductDetails = true,
      eraseTemplateSubject = true,
      mainTitle = '',
      subtitle = '',
      badges = [],
      detectedTextList = [],
      customPrompt = '',
      ratio = '16:9',
      imageModel = 'nano-banana-2',
      language = 'tc',
    } = req.body;

    if (!templateImage) {
      return res.status(400).json({ error: "請上載「參考樣板圖」以提供排版骨架與美術風格" });
    }
    if (!materialImage) {
      return res.status(400).json({ error: "請上載「新圖片素材」以作為人物與產品的唯一來源" });
    }

    const isSimp = language === 'sc';
    const effectiveMainTitle = isSimp ? toServerSimplified(mainTitle) : (mainTitle || '最新焦點熱報');
    const effectiveSubtitle = isSimp ? toServerSimplified(subtitle) : subtitle;
    const effectiveBadges = isSimp 
      ? (Array.isArray(badges) ? badges.map((b: string) => toServerSimplified(b)) : [])
      : badges;

    const parts: ImagePart[] = [];

    // Part 1: Reference Style Template
    const templateInstruction = `
[REFERENCE STYLE TEMPLATE (排版骨架、環境色調、美術風格、光影氛圍與標題字型特效來源)]:
1. LAYOUT & ARTISTIC SOUL: You MUST strictly adopt and reproduce the overall layout composition, background graphic framing, typography font weight, 3D text extrusions, lighting glow, atmospheric color palette, and decorative geometric shapes from this template image.
${eraseTemplateSubject ? '2. RIGID PURGE & CLEAN SLATE (嚴格清除舊人物與舊文字): You MUST completely remove, erase, and wipe away all original characters, actors, faces, humans, and all original old text titles/captions from this template image. The template provides ONLY the decorative background frame, lighting effects, color aesthetic, and font design style.' : ''}
`;
    parts.push({ text: templateInstruction });
    parts.push(await ensureInlineData(templateImage));

    // Part 2: New Material Image (Sole Source of Truth for Subjects)
    const subjectCloningInstruction = `
[NEW MATERIAL SOURCE IMAGE (最終 OG 圖中人物實體、產品與關鍵物件的唯一真實來源)]:
1. PIXEL-PERFECT FACIAL CLONING (人物容貌與姿態鎖定):
   - ${lockFacialIdentity ? 'You MUST 100% pixel-perfect clone and preserve the face, facial expression, eyes, gaze, nose, smile, skin texture, and hairstyle from this material image. STRICTLY ZERO facial distortion, redrawing, artificial beautification, aging, or identity morphing.' : 'Integrate the person from this material image.'}
2. CORE PRODUCT & PROP CLONING (核心產品與道具鎖定):
   - ${lockProductDetails ? 'You MUST 100% preserve and clone the exact products, phones, devices, props, model details, outer silhouettes, material reflections, logos, and proportions seen in this material image.' : 'Integrate the key products from this image.'}
3. VISUAL TONE HARMONIZATION (視覺基調融入):
   - Seamlessly blend and cut out the main subjects/products into the template composition with matching contact lighting and ambient occlusion, without carrying over the raw messy background of this material image.
`;
    parts.push({ text: subjectCloningInstruction });
    parts.push(await ensureInlineData(materialImage));

    // Part 3: Brand Logo Lock
    if (brandLogo) {
      parts.push({
        text: `[BRAND LOGO (像素級鎖定品牌標誌)]:
100% pixel-perfect copy this exact logo without distortion or color shifting. Place it precisely at the corner (top-left or top-right) matching the template layout.`
      });
      parts.push(await ensureInlineData(brandLogo));
    } else if (lockBrandLogo) {
      parts.push({
        text: `[PIXEL-LEVEL BRAND LOGO LOCK (樣板品牌標誌精準還原)]:
If there is a brand logo or emblem in the corners of the reference style template (usually top-left or top-right corner), 100% pixel-perfect preserve and lock it in the exact same corner location without any redrawing or AI modification.`
      });
    }

    // Part 4: Injected Typography & Titles
    const badgeText = Array.isArray(effectiveBadges) && effectiveBadges.length > 0 ? effectiveBadges.join(' | ') : '';
    const typographyDirectives = `
[INJECTED TITLES & ${isSimp ? 'SIMPLIFIED' : 'TRADITIONAL'} CHINESE TYPOGRAPHY]:
- 核心主標題 (Main Title): "${effectiveMainTitle}"
${effectiveSubtitle ? `- 副標題 (Subtitle): "${effectiveSubtitle}"` : ''}
${badgeText ? `- 亮點標籤 / 促銷徽章 (Badges): "${badgeText}"` : ''}

CRITICAL TYPOGRAPHY MANDATES:
1. CHINESE LANGUAGE ONLY: All rendered text MUST strictly be accurate, standard ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体字。' : 'Traditional Chinese (繁體中文).' }
2. STYLISTIC INJECTION: Render the injected main title, subtitle, and badges using the EXACT SAME 3D extrusion, gradient fill, drop-shadow, stroke outline, and visual badge design showcased in the REFERENCE STYLE TEMPLATE.
3. CLEAR READABILITY & NO OVERLAP: Position the title prominently according to the template layout, ensuring it does NOT block the cloned human face or primary product.
`;
    parts.push({ text: typographyDirectives });

    // Part 5: Master Metamorphosis Rules & User Directives
    const masterDirectives = `
[MASTER OG METAMORPHOSIS DIRECTIVES]:
1. NO CYBERPUNK: Absolutely DO NOT use cyberpunk, neon-grid, or glitchy sci-fi themes. Keep the visual tone clean, professional, and faithful to the reference template.
2. 1K RESOLUTION FOCUS: Optimize for sharp, crystal-clear 1K image definition at target aspect ratio (${ratio}).
3. TARGET RATIO: ${ratio} (Standard Open Graph 1200x675 resolution for 16:9). Keep all titles, logos, and critical focal subjects within the safe viewing canvas.
${customPrompt ? `\nUSER SPECIFIC DIRECTIVE:\n${customPrompt}\n` : ''}
`;
    parts.push({ text: masterDirectives });

    await handleImageRequest(
      res,
      imageClient,
      { appModelId: imageModel, parts, aspectRatio: ratio, resolution: '1K' },
      async (image) => ({
        imageUrl: await normalizeImageDimensions(image.dataUrl, ratio, '1K'),
        metadata: {
          ratio,
          model: imageModel,
          timestamp: Date.now(),
        },
      }),
    );
  } catch (error: any) {
    console.error("Error in possession generate API:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message || "OG 奪舍生成失敗" });
  }
});

// ==========================================
// Batch Edit / Google Pic (pics.new) APIs
// ==========================================

// AI 提示詞智能擴寫 (Prompt Magic) using Gemini 3.8 Flash
app.post("/api/batch-edit/prompt-magic", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `你是一位頂級商業攝影大師與 Google Pic (pics.new) 專業提示詞專家。
請將使用者提供的簡短修圖想法擴寫為一段極致細膩、專業的修圖與影像渲染指令。
請補足：精確的光源方向與光質（如黃金時刻斜射光、柔光箱）、材質紋理細節、景深大光圈虛化、色彩平衡與視覺焦點。
文字請使用優美的繁體中文，長度控制在 100-200 字以內，直接輸出擴寫後的提示詞，不要包含任何開場白或問候語。

使用者輸入想法：
"${prompt}"`
    });

    const enhancedPrompt = response.text ? response.text.trim() : prompt;
    return res.json({ enhancedPrompt });
  } catch (error: any) {
    console.error("Error in prompt-magic API:", error);
    res.status(500).json({ error: error.message || "Prompt Magic 擴寫失敗" });
  }
});

// Batch Edit: Process Single Image
app.post("/api/batch-edit/process-image", async (req, res) => {
  try {
    const {
      image,
      maskImage,
      referenceImages = [],
      globalPrompt = '',
      dedicatedPrompt = '',
      modelId = 'nano-banana-2',
      aspectRatio = '4:5',
      resolution = '1K',
      logoConfig,
      language = 'tc',
    } = req.body;

    const isSimp = language === 'sc';
    const effectiveGlobalPrompt = isSimp ? toServerSimplified(globalPrompt) : globalPrompt;
    const effectiveDedicatedPrompt = isSimp ? toServerSimplified(dedicatedPrompt) : dedicatedPrompt;

    const hasImage = Boolean(image && typeof image === 'string' && image.trim().length > 0);
    const baseImage = hasImage ? await getUprightImage(image) : null;
    const combinedPrompt = [effectiveDedicatedPrompt?.trim(), effectiveGlobalPrompt?.trim()].filter(Boolean).join("\n\n");

    if (!hasImage && !combinedPrompt) {
      return res.status(400).json({ error: "留空底圖時（文生圖模式），請輸入提示詞指令以生成圖片。" });
    }

    // Every reference image is sent; the image kit rejects more than the selected model accepts.
    const validReferenceImages = Array.isArray(referenceImages)
      ? referenceImages.filter((img): img is string => Boolean(img && typeof img === 'string'))
      : [];

    const styleReferenceDirective = validReferenceImages.length > 0
      ? `\nCRITICAL STYLE & ARTISTIC REFERENCE MANDATE (${validReferenceImages.length} REFERENCE IMAGES SUPPLIED):
1. STRICT STYLE TRANSFER: You MUST rigorously adopt and reproduce the artistic visual style, color palette, lighting atmosphere, rendering technique, brushstroke texture, and aesthetic mood of the provided style reference images (e.g., Studio Ghibli anime hand-drawn aesthetic, vintage 35mm film color grading, watercolor wash, or specific visual tones).
2. STRICT NEGATIVE INSTRUCTION (NO LAYOUT CLONING): You are ABSOLUTELY FORBIDDEN from copying, cloning, or duplicating the layout, composition, character poses, framing, perspective, or typography/text placement from these reference images.
3. COMPOSITION & RATIO: The spatial composition, scene arrangement, and subject matter MUST STRICTLY follow the user's prompt directive and the target aspect ratio (${aspectRatio}).`
      : '';

    const parts: ImagePart[] = [];

    // Attach style reference images (up to 5) if provided
    if (validReferenceImages.length > 0) {
      for (let idx = 0; idx < validReferenceImages.length; idx++) {
        const refImg = validReferenceImages[idx];
        parts.push({
          text: `[STYLE & ARTISTIC REFERENCE IMAGE #${idx + 1} OF ${validReferenceImages.length}]
MANDATORY STYLE TRANSFER DIRECTIVE:
1. RIGIDLY ADOPT AND REPRODUCE the visual art style, color palette, lighting atmosphere, rendering technique, stroke texture, and aesthetic mood of this reference image (e.g., Studio Ghibli anime hand-drawn aesthetic, watercolor wash, vintage film color grading, or specific visual tones).
2. ABSOLUTELY DO NOT copy the layout, composition, character poses, framing, perspective, or typography/text placement from this reference image.
3. The spatial composition, perspective, subject matter, and layout MUST STRICTLY follow the user's prompt directive and the target aspect ratio.`
        });
        parts.push(await ensureInlineData(refImg));
      }
    }

    if (hasImage) {
      // Image-to-Image mode
      parts.push({ text: "SOURCE BASE IMAGE (The core image to edit, inpaint, or transform):" });
      parts.push(await ensureInlineData(baseImage));

      // Add inpaint mask if user provided one
      if (maskImage) {
        parts.push({ text: "INPAINT MASK (CRITICAL: White pixels indicate the precise area to be edited, replaced, or erased. Black pixels MUST be 100% preserved and kept completely untouched):" });
        parts.push(await ensureInlineData(maskImage));
      }

      // Google Pic comprehensive prompt instructions
      const fullInstruction = `
You are the Google Pic (pics.new) precision AI image editing & generative enhancement engine.
Based on the provided SOURCE BASE IMAGE (and optional INPAINT MASK), perform the required photographic modifications.

CORE EDITING CAPABILITIES & RULES:
1. PRECISION INPAINTING & OBJECT SWAP: If an Inpaint Mask is provided, or if specific elements/objects/clothing are targeted, modify ONLY those targeted areas. Keep all other regions, facial identities, and pixel details 100% untouched.
2. MAGIC ERASER: When requested to remove people, clutter, cables, or watermarks, seamlessly fill the void using surrounding textures, realistic lighting, and natural depth of field. Leave zero blur or smudge marks.
3. SMART CUTOUT & BACKGROUND REPLACEMENT: If requested to cutout or replace backgrounds, maintain sub-pixel hair-strand detail. Harmonize the subject with new ambient light, reflections, and contact shadows.
4. IN-IMAGE TEXT & TRANSLATION: If translating or altering text in posters/signs, preserve the exact perspective, font weight, lighting, and wear-and-tear of the original sign. If translating to Simplified Chinese (簡中), output clean, standard Simplified Chinese (簡體中文). If translating to Traditional Chinese (繁中), output clean Traditional Chinese (繁體中文).
5. ULTRA HIGH FIDELITY: Enhance skin pores, eye reflections, fabrics, and micro-textures without artificial over-sharpening or plastic looks.
6. ASPECT RATIO FIDELITY: Maintain the composition without stretching or distortion.
7. LANGUAGE: All in-image text MUST strictly be in ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).' }
${styleReferenceDirective}

GLOBAL EDIT DIRECTIVE:
${effectiveGlobalPrompt || 'Photographic enhancement and realistic touch-up.'}

DEDICATED IMAGE DIRECTIVE:
${effectiveDedicatedPrompt || 'Follow global directive with high fidelity.'}
`;
      parts.push({ text: fullInstruction });
    } else {
      // Text-to-Image mode (user left the slot blank)
      const textToImageInstruction = `
You are an elite photographic and visual image generation engine.
Generate a master-level, aesthetically breathtaking, photorealistic image based on the following creative prompt directive:

PROMPT DIRECTIVE:
${combinedPrompt}

CRITICAL RULES:
1. STRICT SUBJECT FIDELITY (100% USER SUBJECT PRIORITY):
   - The user's input text (headlines, product names, vehicles, architectural subjects, animals, specific characters) defines the ABSOLUTE CORE SUBJECT of the image (e.g., if the user wrote "比亞迪M9及ATTO1汽車", the cars MUST be the primary focal subjects).
   - Any preset style directives (such as K-Pop MV aesthetic, Wong Kar-wai cinematic, cyberpunk, anime, vintage film) specify ONLY the lighting, color palette, camera angles, material reflections, and atmosphere.
   - ABSOLUTELY DO NOT replace or dilute the user's specified subject with generic style stereotypes (e.g., DO NOT generate human K-pop boy/girl idols or dancers when the prompt is about cars or products; instead, place the specified cars/products into the dynamic K-pop stage lighting and reflections).
2. High Aesthetic Quality & Photographic Realism: Render vivid lifelike textures, natural depth-of-field, realistic ambient lighting, and cinematic color harmony.
3. Composition & Aspect Ratio: Perfectly compose the visual scene according to the requested ratio without cutting off primary subjects or focal points.
4. Language & Typography: If any text, logos, or slogans appear within the image, they MUST strictly be in ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).' }
5. No blur, artifacts, plastic looks, or unnatural distortions.
${styleReferenceDirective}
`;
      parts.push({ text: textToImageInstruction });
    }

    const targetRes = resolution === '4K' ? '4K' : resolution === '2K' ? '2K' : '1K';
    // "original" keeps the base image's aspect; a slot without a base image (text-to-image) is 1:1.
    const keepOriginal = !aspectRatio || aspectRatio === 'original';
    const baseSize = keepOriginal && baseImage ? await getImageSize(baseImage) : null;
    if (keepOriginal && hasImage && !baseSize) {
      return res.status(400).json({ error: "無法讀取底圖的尺寸，請重新上載底圖後再試。" });
    }
    const aspect = !keepOriginal
      ? { aspectRatio }
      : baseSize
        ? { aspectRatio: `${baseSize.width}:${baseSize.height}`, keepInputAspect: true }
        : { aspectRatio: '1:1' };

    await handleImageRequest(
      res,
      imageClient,
      { appModelId: modelId, parts, resolution: targetRes, ...aspect },
      async (generated) => {
        // Normalize image dimensions to target ratio and resolution; "original" keeps the base image's
        // exact aspect at the generated size (models without that ratio return the nearest one)
        let imageUrl = !keepOriginal
          ? await normalizeImageDimensions(generated.dataUrl, aspectRatio, targetRes)
          : baseSize
            ? await cropToAspect(generated.dataUrl, baseSize.width, baseSize.height)
            : generated.dataUrl;
        // If logoConfig is provided, stamp logo onto the generated image using Sharp
        if (logoConfig && logoConfig.logoUrl) {
          imageUrl = await stampLogoOnImage(imageUrl, logoConfig);
        }
        return { imageUrl };
      },
    );
  } catch (error: any) {
    console.error("Error in process-image API:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message || "圖片處理演算失敗" });
  }
});

// Vite & Static file serving setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
