import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { AppImageError, errorDetails, prepareAppImage, runAppImage, type ImagePart } from "./server/imageClient";
import { imageModelView, listImageModels } from "./server/imageModels";
import { streamImageResponse } from "./server/ndjson";

const app = express();
const PORT = 3000;

// Increase payload size limits for base64 image transfers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Helper to resolve third-party URLs to Base64 in Node.js
const urlToAsset = async (url: string) => {
  if (url.startsWith("data:")) {
    const mimeType = url.match(/:(.*?);/)?.[1] || "image/jpeg";
    const data = url.split(",")[1];
    return { data, mimeType };
  }
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  return {
    data: buffer.toString("base64"),
    mimeType
  };
};

// API: Check config if api key is present on the server
app.get("/api/config", (req, res) => {
  const hasKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  res.json({ hasApiKey: hasKey });
});

// API: Image models for the selector, with limits from the pi-ai-extra catalogues and key availability
app.get("/api/image-models", (req, res) => {
  res.json({ models: listImageModels() });
});

/** Edits keep the previous fixed temperature, sent only to models that accept temperature. */
const EDIT_TEMPERATURE = 0.7;

/** Errors found before streaming starts (unknown model, missing key, unsupported option) as JSON. */
function sendImageError(res: express.Response, route: string, error: unknown) {
  console.error(`[PROXY ERROR] ${route} failed:`, error);
  if (res.headersSent) return;
  const status = error instanceof AppImageError ? error.httpStatus : 500;
  res.status(status).json({ error: error instanceof Error ? error.message : String(error), details: errorDetails(error) });
}

// Helper to extract and format HTML text into clean, structured paragraphs
function parseHtmlToStructuredParagraphs(html: string): string {
  // 1. Remove non-article script/style/nav/header/footer/iframe/comment blocks
  let clean = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");

  // 2. Convert block-level elements & breaks to explicit double newlines
  clean = clean
    .replace(/<\/(p|div|h[1-6]|li|article|section|blockquote|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(p|div|h[1-6]|li|article|section|blockquote|tr)[^>]*>/gi, "\n\n");

  // 3. Remove all remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, " ");

  // 4. Decode common HTML entities
  clean = clean
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "...")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’");

  // 5. Split into lines and clean whitespace
  const rawLines = clean.split(/\r?\n/);
  const processedParagraphs: string[] = [];

  for (let line of rawLines) {
    // Normalize spaces within line
    line = line.replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;

    // Filter out obvious noise lines
    if (line.length < 2) continue;
    
    // Ignore lines that are pure noise/nav elements
    const isNoise = /^(主頁|首頁|關於我們|聯絡我們|按此|讚好|分享|留言|追蹤|廣告|Copyright|All [Rr]ights [Rr]eserved|隱私條款|服務條款)$/i.test(line);
    if (isNoise) continue;

    processedParagraphs.push(line);
  }

  // Group consecutive text into clean paragraphs separated by double newlines (\n\n)
  return processedParagraphs.join("\n\n");
}

// API: Fetch article content from URL
app.post("/api/fetch-article", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "請提供有效的文章網址。" });
    }

    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh-HK,zh;q=0.9,en;q=0.8"
      }
    });

    if (!response.ok) {
      return res.status(400).json({ error: `無法抓取網頁內容 (HTTP ${response.status})。請確認網址或直接貼上文章內文。` });
    }

    const html = await response.text();

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) || html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : "";

    // 1. Extract raw paragraph text from HTML with block tag separation
    let rawContent = parseHtmlToStructuredParagraphs(html);

    if (rawContent.length > 15000) {
      rawContent = rawContent.substring(0, 15000);
    }

    if (rawContent.length < 30) {
      return res.status(400).json({ error: "抓取到的文章內容過短，可能是防爬蟲或需要登入的網頁。請直接複製文章內容貼上。" });
    }

    // 2. AI-Powered Paragraph Formatting & Noise Removal (if Gemini API key is available)
    let finalContent = rawContent;
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `
你是一位專業的繁體中文新聞編輯與文字排版專家。
請閱讀以下從網頁擷取的文章草稿內容，將其整理為「段落分明、順暢易讀」的繁體中文文章內文。

【排版與編輯要求】
1. 嚴格保留文章中的全部新聞事實、人物對話、數據與核心細節，絕對不可刪減核心報導內容或自行虛構。
2. 剔除非文章主體的網頁雜訊（例如：導覽選單、按讚分享提示、相關文章連結、版權宣告、廣告等）。
3. 依據語意邏輯重新劃分段落，每段長度適中（約 2 至 4 句話），段落與段落之間以雙換行 (\\n\\n) 分隔。
4. 修正有明顯錯漏的句讀標點，確保全篇文字清晰流暢、排版整齊。
5. 直接輸出排版好的文章內文，不要附帶任何開頭說明（如「以下是整理後的文章：」）或 Markdown 標記。

【原始文章內容】
${rawContent.slice(0, 12000)}
`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: prompt,
        });

        const formattedText = response.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || "";
        if (formattedText.trim().length >= 30) {
          finalContent = formattedText.trim().replace(/```markdown/g, "").replace(/```/g, "").trim();
        }
      } catch (aiErr) {
        console.warn("[FETCH ARTICLE AI FORMATTING] Gemini formatting fallback:", aiErr);
      }
    }

    return res.json({ title: pageTitle, content: finalContent });
  } catch (err: any) {
    console.error("[PROXY ERROR] fetch-article failed:", err);
    return res.status(500).json({ error: `無法連線至網址: ${err.message || err.toString()}` });
  }
});

// API: Extract images from page URL (OG Image + Content Images)
app.post("/api/extract-page-images", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "請提供有效的文章網址。" });
    }

    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh-HK,zh;q=0.9,en;q=0.8"
      }
    });

    if (!response.ok) {
      return res.status(400).json({ error: `無法連線至網頁 (HTTP ${response.status})` });
    }

    const html = await response.text();
    const extractedUrls: { url: string; isOg: boolean; name: string }[] = [];

    // 1. OG Image & Twitter Image
    const ogRegexes = [
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi
    ];

    for (const regex of ogRegexes) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        if (match[1]) {
          try {
            const rawUrl = match[1].replace(/&amp;/g, '&').trim();
            const abs = new URL(rawUrl, targetUrl).href;
            if (!extractedUrls.some(e => e.url === abs)) {
              extractedUrls.push({ url: abs, isOg: true, name: "網頁 Open Graph 封面圖" });
            }
          } catch (e) {}
        }
      }
    }

    // 2. Article inline img tags
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      if (imgMatch[1]) {
        try {
          const raw = imgMatch[1].replace(/&amp;/g, '&').trim();
          if (raw.includes('.svg') || raw.includes('icon') || raw.includes('logo') || raw.includes('avatar') || raw.includes('pixel') || raw.includes('tracker')) continue;
          const abs = new URL(raw, targetUrl).href;
          if (!extractedUrls.some(e => e.url === abs)) {
            extractedUrls.push({ url: abs, isOg: false, name: `文章內文圖片 ${extractedUrls.length + 1}` });
          }
        } catch (e) {}
      }
    }

    const topCandidates = extractedUrls.slice(0, 5);

    if (topCandidates.length === 0) {
      return res.status(404).json({ error: "網頁中未發現適合的 Open Graph 或內文圖片。" });
    }

    // Download top candidate images on server side to convert to Base64 Data URLs
    const downloadedImages = [];
    for (const candidate of topCandidates) {
      try {
        const asset = await urlToAsset(candidate.url);
        if (asset && asset.data && asset.data.length > 500) {
          const dataUrl = `data:${asset.mimeType};base64,${asset.data}`;
          downloadedImages.push({
            name: candidate.name,
            dataUrl,
            isOg: candidate.isOg
          });
        }
      } catch (err) {
        console.warn("Failed to download extracted image:", candidate.url, err);
      }
    }

    if (downloadedImages.length === 0) {
      return res.status(500).json({ error: "無法下載網頁中的圖片素材，請嘗試手動上載。" });
    }

    return res.json({ images: downloadedImages });
  } catch (err: any) {
    console.error("[PROXY ERROR] extract-page-images failed:", err);
    return res.status(500).json({ error: `抓取網頁圖片失敗: ${err.message || err.toString()}` });
  }
});

// API: Generate viral title groups using Gemini text model
app.post("/api/generate-viral-titles", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: "Missing backend Gemini API Key" });
    }

    const { articleText, textModel, limits } = req.body;
    if (!articleText || typeof articleText !== "string") {
      return res.status(400).json({ error: "請提供文章內文" });
    }

    const mainMax = limits?.mainMax || 13;
    const subMax = limits?.subMax || 13;
    const smallMax = limits?.smallMax || 13;

    const ai = new GoogleGenAI({ apiKey });

    // Model selection
    const selectedModel = (textModel === "gemini-3.8-flash" || textModel === "gemini-3.7-flash") 
      ? "gemini-3.8-flash" 
      : (textModel === "gemini-3.5-flash-lite" ? "gemini-3.5-flash-lite" : "gemini-3.8-flash");

    const prompt = `
你是一位精通香港與台灣社交媒體 (Facebook / Instagram / Threads) 病毒式傳播的資深總編輯與社群營運專家。
請閱讀以下文章內容，並創作 5 組專為 Open Graph (OG) 視覺圖片設計的爆款極具吸引力標題。

【標題組結構】
每組標題必須包含三個層級：
1. 大標題 (main): 核心爆點，簡短極具震撼力 (字數限制: 2 至 ${mainMax} 個字)
2. 中標題 (sub): 補充關鍵細節或衝突點 (字數限制: 2 至 ${subMax} 個字)
3. 小標題 (small): 標籤/情境/情緒觸發詞 (字數限制: 2 至 ${smallMax} 個字)

【標題文字風格與情緒要求】
- 專門適合做成社群媒體 OG 圖上標題，能瞬間在動態消息 (Feed) 中抓住讀者眼球，引發瘋狂轉發、按讚與留言討論。
- 情緒共鳴與修辭：語氣可感性、尖銳、高度張力、衝突感、懸疑、具爭議性或驚嚇性。靈活運用誇張、對比、懸念等修辭技巧包裝事件與人物。
- 使用正體中文 (繁體中文)，語言口吻在地化、流暢且力道十足。

【輸出格式要求】
請嚴格輸出合法 JSON 格式，為一個陣列 (JSON Array)，包含 5 個物件，格式如下：
[
  {
    "groupIndex": 1,
    "main": "大標題文字",
    "sub": "中標題文字",
    "small": "小標題文字"
  },
  ...
]

不要包含任何 Markdown 格式或額外的文字開頭，直接輸出 JSON 陣列。

【文章內容】
${articleText.slice(0, 10000)}
`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const outputText = response.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || "";
    
    let titles = [];
    try {
      titles = JSON.parse(outputText);
    } catch (e) {
      const cleaned = outputText.replace(/```json/g, "").replace(/```/g, "").trim();
      titles = JSON.parse(cleaned);
    }

    if (!Array.isArray(titles) || titles.length === 0) {
      throw new Error("模型未產生合規的標題陣列，請重試");
    }

    return res.json({ titles });
  } catch (err: any) {
    console.error("[PROXY ERROR] generate-viral-titles failed:", err);
    return res.status(500).json({ error: err.message || err.toString() });
  }
});

// API: Process Collage Generation via Tokyo Cloud Run server proxy
app.post("/api/generate-collage", async (req, res) => {
  try {
    const {
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
      prohibitPretrainedLogo,
      eraseText,
      titleConfig,
      selectedModel,
      temperature
    } = req.body;

    const isProhibitPretrained = prohibitPretrainedLogo !== false;
    let pretrainedLogoRule = "";
    if (isProhibitPretrained) {
      pretrainedLogoRule = `
         - PROHIBIT PRE-TRAINED BRAND LOGO DATABASE DATA (STRICT ACTIVE): You are STRICTLY FORBIDDEN from drawing, hallucinating, or rendering any brand logos, channel badges, or media watermarks from your pre-trained knowledge base/memory (such as "香港01", "HK01", "TVB", "BBC", "CNN", "YouTube", "Apple", "Nike", etc.) unless the exact logo pixels are explicitly provided in the uploaded template/source images or replacement logo assets supplied by the user. Under no circumstances are you permitted to generate pre-trained brand logos from your internal knowledge base.
      `;
    } else {
      pretrainedLogoRule = `
         - PRE-TRAINED BRAND LOGO DATABASE ALLOWED: You are PERMITTED to draw or reference recognized brand/media logos from your pre-trained knowledge base if relevant to the article context or template style.
      `;
    }

    if (temperature !== undefined && (typeof temperature !== "number" || !Number.isFinite(temperature))) {
      return res.status(400).json({ error: "temperature 必須是數字。", details: { code: "invalid_request" } });
    }
    const parts: ImagePart[] = [];

    const isNanoBanana2 = imageModelView(String(selectedModel ?? ""))?.promptProfile === "nano-banana-2";

    let nanoBanana2SourceInstruction = "";
    if (isNanoBanana2 && sourceAssets && sourceAssets.length > 0) {
      nanoBanana2SourceInstruction = `
         11. NANO BANANA 2 EXCLUSIVE SOURCE SUBJECT EXTRACTION MANDATE (新圖素材專屬強制讀取與提煉指令):
         - CRITICAL DIRECTIVE: You have received ${sourceAssets.length} image(s) explicitly designated as SOURCE SUBJECT.
         - MANDATORY READ & EXTRACTION: You MUST inspect, read, and extract the primary human subject (person, face, body), main object, or key event subject from the provided SOURCE SUBJECT image(s).
         - FOREGROUND PLACEMENT: Composite and place this extracted subject from the SOURCE SUBJECT image into the central foreground of the new generated collage.
         - STRICT DO-NOT-SKIP RULE: Under no circumstances are you permitted to skip, ignore, or drop the SOURCE SUBJECT image when generating the output.
      `;
    }

    if (templateAssets && templateAssets.length > 0) {
      templateAssets.forEach((tmpl: any, idx: number) => {
        if (isNanoBanana2) {
          parts.push({
            text: `[STYLE TEMPLATE REFERENCE ${idx + 1} - USE ONLY FOR ART STYLE/TYPOGRAPHY/LAYOUT, DO NOT COPY SUBJECTS]:`
          });
        }
        parts.push({
          inlineData: {
            data: tmpl.data,
            mimeType: tmpl.mimeType,
          }
        });
        parts.push({
          text: `REFERENCE IMAGE ${idx + 1} (STYLE TEMPLATE): Use this image STRICTLY as a visual blueprint for art style, typography, font pairing, color palette, graphic composition, and overall design vibe. ABSOLUTE PROHIBITION: Do NOT copy, repeat, or transfer ANY person (human face, character, figure) or ANY subject object (vehicles, items, products, animals, buildings, props) from this Style Template into the generated output. The subjects and objects in this template belong strictly to the template and must be excluded from the final output.`
        });
      });
    }

    const templateCount = templateAssets ? templateAssets.length : 0;
    if (sourceAssets) {
      sourceAssets.forEach((img: any, index: number) => {
        if (isNanoBanana2) {
          parts.push({
            text: `[PRIMARY SOURCE SUBJECT ${index + 1} - MUST READ AND EXTRACT SUBJECT/PERSON FROM THIS IMAGE]:`
          });
        }
        parts.push({
          inlineData: {
            data: img.data,
            mimeType: img.mimeType,
          }
        });
        parts.push({ text: `REFERENCE IMAGE ${index + 1 + templateCount} (SOURCE SUBJECT): This contains the Main Subject (person, main object, or key event scene) to be placed into the new generated image.` });
      });
    }

    let compositingRule = `4. COMPOSITING METHOD: PRESERVE ORIGINAL BACKGROUND (DEFAULT ACTIVE). Do NOT cutout or remove the background from the Source Subject image. Treat the entire Source Image (Subject + Background) as a single flat asset and integrate it harmoniously into the layout defined by the Style Template(s).`;
    if (removeBackground) {
        compositingRule = `4. COMPOSITING METHOD: STRICT AUTO CUTOUT / BACKGROUND REMOVAL (ACTIVE). You MUST perform intelligent cutout / background removal on the Source Subject. Isolate the main subject / person / object with clean edges and remove the original background completely. Extract ONLY the isolated subject and composite them onto the new layout derived from the Style Template. Do NOT carry over any pixels from the original background.`;
    } else if (preserveBackground) {
        compositingRule = `4. COMPOSITING METHOD: PRESERVE ORIGINAL BACKGROUND (ACTIVE). Do NOT cutout or remove the background from the Source Subject image. Treat the entire Source Image (Subject + Background) as a single flat asset and integrate it naturally into the layout defined by the Style Template(s), preserving its original background environment.`;
    }

    const templateStyleRule = `
         STYLE TEMPLATE BLUEPRINT & STRICT ISOLATION RULES (HIGHEST VISUAL FIDELITY):
         1. EXPLICIT VISUAL BLUEPRINT MAPPING: You MUST strictly analyze and adopt the exact visual language of the STYLE TEMPLATE(s):
            - ART STYLE & ATMOSPHERE: Match the overall mood, tone, lighting style, color saturation, contrast level, color palette (dominant background hues and accent colors), noise/grain texture, and background composition.
            - TYPOGRAPHY & FONT PAIRING: Replicate the typography design from the Style Template — including font weight (e.g. ultra-bold, heavy impact), font style (sans-serif, news headline style, brush, neon, shadow, stroke), character tracking/spacing, and color combinations. Apply this exact typographic treatment to the new headline texts.
            - LAYOUT & SPATIAL STRUCTURE: Mirror the structural layout, text alignment, headline position, border margins, graphic accents, and spatial hierarchy of the Style Template.
         2. ABSOLUTE SUBJECT & OBJECT PROHIBITION (DO NOT COPY TEMPLATE SUBJECTS/OBJECTS):
            - Do NOT copy, clone, or leak ANY human figure, face, character, or person from the Style Template into the generated output.
            - Do NOT copy, clone, or leak ANY subject object (e.g., inanimate objects, cars, products, devices, animals, buildings, or specific props) from the Style Template.
            - The Style Template serves ONLY as a stylistic and structural blueprint. All subjects and objects in the output MUST come from the SOURCE SUBJECT image(s) or be newly synthesized according to the article context.
    `;

    let logoInstruction = "";
    if (copyLogo && prohibitLogo) {
      logoInstruction = `
         3. LOGO HANDLING (STRICT PIXEL-PERFECT LOGO COPY MODE): 
         - CRITICAL MANDATE: The user explicitly requires the EXACT brand logo / channel watermark / media badge from the STYLE TEMPLATE (e.g. top-left or top-right logo badges like "香港01" or channel icons) to be preserved on the output.
         - ACTION 1 (EXACT PIXEL REPLICATION): Detect the brand logo region in the provided Style Template image. Precisely extract and copy those exact logo pixels onto the generated output image in the exact corresponding location, scale, and color.
         - ACTION 2 (NO GENERATED TEXT / NO FAKE LOGOS): Do NOT try to invent, draw, or re-type the logo using text synthesis. You MUST copy the genuine logo graphics directly from the template or leave the logo box clean.
         - SUMMARY: Pixel-perfect template logo replication mandatory.
         ${pretrainedLogoRule}
      `;
    } else if (copyLogo) {
      logoInstruction = `
         3. LOGO HANDLING (EXACT LOGO COPY MODE): 
         - DETECT and COPY the exact brand logo / watermark / icon found in the STYLE TEMPLATE (usually top-left or top-right corners).
         - REPLICATE that exact logo onto the output image in the same position and aspect ratio.
         ${pretrainedLogoRule}
      `;
    } else if (prohibitLogo) {
      logoInstruction = `
         3. STRICT LOGO & WATERMARK CLEANING:
         - TARGET: Specific media watermarks (e.g., "香港01", "HK01", "01") often appear in the top-left or top-right corners of the Style Templates.
         - ACTION: You MUST NOT generate these logos in the output.
         - CLEANUP: If the style template mimics a news layout with a corner logo, replace that logo with EMPTY SPACE or extend the BACKGROUND PATTERN.
         - PROHIBITION: Do not attempt to spell "香港01" or generate similar shaped blue/white icons. Keep the corners clean unless the User Prompt asks for a specific title.
         ${pretrainedLogoRule}
      `;
    } else {
      logoInstruction = `3. LOGO HANDLING: The user has no specific preference for template logos. ${pretrainedLogoRule}`;
    }

    let textCleaningInstruction = "";
    if (eraseText) {
      textCleaningInstruction = `
         8. TEXT CLEANING PROTOCOL (ACTIVE):
         - IGNORE CONTENT: Ignore the actual words and sentences written in the Style Template.
         - CLEAN LAYOUT: When designing the background, do NOT reproduce the specific headlines or captions from the template.
         - REPLACEMENT: Replace original text areas with empty space, generic design elements, or the User's specific new headline if provided.
         - GOAL: The style (font weight, color, placement) is preserved, but the "text content" is erased/reset.
      `;
    }

    let specificTitleInstruction = "";
    if (titleConfig) {
        const { main, sub, small, tiny } = titleConfig;
        const titleList = [];
        
        const getColorInstruction = (item: any) => {
            return item.isAutoColor ? "AUTO (Select high-contrast color based on background)" : item.color;
        };

        if (main && main.text) titleList.push(`- MAIN TITLE (大標題): "${main.text}" [Color: ${getColorInstruction(main)}, Size: approx ${main.size}px, Weight: Heavy/Bold]`);
        if (sub && sub.text) titleList.push(`- SUB TITLE (中標題): "${sub.text}" [Color: ${getColorInstruction(sub)}, Size: approx ${sub.size}px, Weight: Medium]`);
        if (small && small.text) titleList.push(`- SMALL TITLE (小標題): "${small.text}" [Color: ${getColorInstruction(small)}, Size: approx ${small.size}px, Weight: Normal]`);
        if (tiny && tiny.text) titleList.push(`- TINY TITLE (小小標題): "${tiny.text}" [Color: ${getColorInstruction(tiny)}, Size: approx ${tiny.size}px, Weight: Light]`);
        
        if (titleList.length > 0) {
            specificTitleInstruction = `
            9. SPECIFIC TYPOGRAPHY INSTRUCTIONS (HIGHEST PRIORITY):
            The user has provided exact text to render. You MUST render these texts clearly and legibly into the final image, integrating them into the layout derived from the Style Template.
            
            REQUIRED TEXTS:
            ${titleList.join("\n")}
            
            PLACEMENT RULES:
            - Use the Style Template to determine WHERE to place headlines (e.g. if template has a big headline at the bottom, place the MAIN TITLE there).
            - Ensure high contrast against the background.
            - Use a professional, clean font (Sans-serif typical for news).
            `;
        }
    }

    const textInstruction = `
         5. CHINESE TYPOGRAPHY PROTOCOL (STRICT TEXT RESTRICTIONS):
         - TARGET: Traditional Chinese (繁體中文).
         - QUALITY: Text must be rendered with high resolution. 
         - STROKES: Ensure complex characters are distinct. NO "mojibake", NO gibberish, NO "tofu" boxes, NO malformed strokes.
         - FONT: Use professional sans-serif fonts typical of modern news media (e.g., Noto Sans TC style) unless the template suggests otherwise.
         - NO UNSOLICITED TEXT / STRICT PROHIBITION: You are STRICTLY PROHIBITED from adding or hallucinating any text, headlines, subtitles, labels, or captions of your own. Do NOT make up any text or randomly generate sentences/words.
         - ONLY USER-PROVIDED TEXT ALLOWED: The ONLY text permitted on the generated collage is the text explicitly provided by the user (as specified in "REQUIRED TEXTS" or the user command). If no text is provided, the final output image MUST contain NO text layers at all.
         - REMOVE STALE TEMPLATE TEXT: Do NOT copy, repeat, or reproduce the existing text content from the Style Template unless those specific words are explicitly requested or provided by the user. If the Style Template has a headline block and the user hasn't specified what text goes there, leave that block completely BLANK or filled only with background patterns, rather than writing random or placeholder text.
    `;
    
    let subjectIntegrityInstruction = "";
    if (sourceAssets && sourceAssets.length > 0) {
      subjectIntegrityInstruction = `
         7. SUBJECT INTEGRITY & HALLUCINATION PREVENTION (CRITICAL):
         - NO NEW PEOPLE: You are strictly PROHIBITED from generating new people, bystanders, crowds, or extra characters. The output must contain ONLY the subject(s) provided in the Source Image.
         - PIXEL COPY: Treat the Source Subject as a digital cutout. Copy their pixels exactly.
         - POSE LOCK: Do NOT change the subject's pose, hand gestures, or body language. If they are standing, keep them standing. If they are looking left, keep them looking left.
         - EXPRESSION LOCK: Do NOT change the subject's facial expression. Do NOT make them smile if they are serious.
      `;
    } else {
      subjectIntegrityInstruction = `
         7. AUTONOMOUS VISUAL CREATION MODE (NO SOURCE IMAGE PROVIDED):
         - The user has provided NO source image for the main subject.
         - AUTONOMOUS CREATION MANDATE: You MUST autonomously create and synthesize a compelling, high-impact, and relevant main visual subject, character, object, or scene directly inspired by the article headline titles and topic context!
         - Integrate this newly generated visual subject seamlessly into the layout structure, background style, and color palette derived from the Style Template.
      `;
    }

    let safeArea300x250Instruction = "";
    if (ratio === "300x250" || ratio === "320x250") {
      safeArea300x250Instruction = `
         10. EXCLUSIVE 300x250 ADVERTISEMENT SAFE AREA MARGIN MANDATE (適用 300x250 廣告專用比例):
         - TARGET FORMAT: 300 x 250px Advertising Banner format.
         - MANDATORY SAFE AREA MARGIN: You MUST enforce an inner safe padding margin of at least 12% to 15% from all four canvas edges (Top, Bottom, Left, Right).
         - ELEMENT CONCENTRATION: All brand logos (top-left/top-right badges), main headlines, sub-headlines, and text captions MUST be concentrated strictly inside the central 80% safe zone of the canvas.
         - PREVENT EDGE CROPPING: Keep all titles and logos away from the top, bottom, left, and right outer borders so that no text or logo pixels are cropped when framed in 300x250.
      `;
    }

    let verticalLayoutInstruction = "";
    if (ratio === "4:5" || ratio === "9:16" || ratio === "2:3" || (sourceAssets && sourceAssets.length >= 2)) {
      verticalLayoutInstruction = `
         12. COMPOSITION & PROPORTION MANDATE FOR MULTI-SOURCE & VERTICAL CANVAS (4:5 與多圖無邊框構圖/人像不擠壓規則):
         - ASPECT RATIO & PROPORTION LOCK (不垂直擠壓人像): You MUST preserve the exact natural aspect ratio and physical proportions of all human subjects/persons from the source image(s). Do NOT compress, squish, stretch, or deform people vertically or horizontally.
         - STRICT NO SPLIT-PANEL BORDERS RULE (嚴禁分割框/ Panel 框線): Do NOT create separate top/bottom framed panels, border boxes, or horizontal dividing lines across the image.
         - UNIFIED CONTINUOUS BACKDROP (單一連貫背景): Maintain a single, continuous, seamless background scene/atmosphere across the entire canvas.
         - NATURAL MULTI-SUBJECT LAYOUT (自然融入畫面): When multiple source subjects are present, position them harmoniously within the single continuous scene (e.g. upper and lower visual focal zones) with blended lighting, without drawing artificial frame boxes or border dividers around them.
      `;
    }

    const systemInstruction = strictFidelity 
      ? `ROLE: Expert Digital Retoucher & Compositor.
         GOAL: Composite the Source Subject into the layout defined by the Style Template(s) with 100% pixel-perfect fidelity to the subject's face/body/identity, strictly adhering to the Style Template's visual blueprint and excluding all template subjects/objects.
         
         CORE DIRECTIVE: PRESERVE CHARACTER CONSISTENCY AT ALL COSTS.
         
         STRICT RULES:
         ${templateStyleRule}
         1. FACE LOCK: The facial features (eyes, nose, mouth, shape) must be IDENTICAL to the source. Do not "re-imagine", "beautify" or "cartoonify" the person.
         2. ANGLE LOCK: The head angle and camera perspective must match the source image exactly. Do not rotate the head. If the source looks left, the result looks left.
         3. EXPRESSION LOCK: Preserve the exact facial expression.
         4. PROPORTION LOCK: Preserve natural human body aspect ratios. STRICT PROHIBITION against vertical squishing, stretching, or aspect distortion of human subjects.
         ${logoInstruction}
         5. ${compositingRule}
         ${textInstruction}
         6. NO BORDERS OR SPLIT PANELS: Do NOT generate decorative borders, frames, or horizontal split-panel dividing lines around or inside the image.
         ${subjectIntegrityInstruction}
         ${textCleaningInstruction}
         ${specificTitleInstruction}
         ${safeArea300x250Instruction}
         ${verticalLayoutInstruction}
         ${nanoBanana2SourceInstruction}
         
         If the user prompt conflicts with the source image's reality (e.g. "make him smile" when he is frowning), IGNORE the prompt and PRESERVE the source.`
      : `ROLE: Expert Creative Director & Graphic Designer.
         GOAL: Create high-impact Open Graph (OG) social media images by strictly adhering to the visual style, typography, color palette, and layout blueprint of the provided STYLE TEMPLATES.
         
         STYLE INSTRUCTIONS:
         ${templateStyleRule}
         ${logoInstruction}
         ${textInstruction}
         4. ${compositingRule}
         ${subjectIntegrityInstruction}
         ${textCleaningInstruction}
         ${specificTitleInstruction}
         ${safeArea300x250Instruction}
         ${verticalLayoutInstruction}
         ${nanoBanana2SourceInstruction}
         
         NEGATIVE CONSTRAINTS:
         ${copyLogo ? "- LOGO MANDATE: You MUST preserve and copy the brand logo from the Style Template as specified in Rule 3." : "- Do NOT generate specific news brand logos (e.g. HK01) from the template unless explicitly instructed."}
         - NO BORDERS OR SPLIT-PANEL DIVIDERS: Do NOT generate decorative borders, frames, or horizontal split-panel dividing lines around or inside the image.
         - NO EXTRA PEOPLE: Do not hallucinate crowds or other people.
         - NO TEMPLATE SUBJECT/OBJECT LEAKAGE: Do NOT copy any persons, human figures, characters, or inanimate subject objects from the Style Template.
         - NO SUBJECT DISTORTION: Maintain original human body proportions without vertical squishing or stretching.
         `;

    const fidelityInstructions = strictFidelity 
      ? `
        ### STRICT FIDELITY PROTOCOL (ACTIVE - DO NOT DEVIATE) ###
        1. DO NOT GENERATE A NEW FACE. USE THE SOURCE FACE.
        2. EXACT IDENTITY: The face, facial features, and expression must be PIXEL-PERFECT to the source.
        3. EXACT ANGLE: The head tilt, rotation, and camera angle must remain 100% unchanged.
        4. NO HALLUCINATION: Do not add extra limbs, new hair styles, or change the clothing unless asked.
        5. ${compositingRule}
        ` 
      : `
        1. PRESERVE SUBJECT: Keep the identity and main features of the person/subject in the SOURCE SUBJECT image recognizable.
        2. NO EXTRA PEOPLE: Do not add any other humans to the composition.
        3. ${compositingRule}
      `;

    const finalPrompt = `
      TASK: Generate a professional Open Graph image strictly adhering to the visual blueprint of the uploaded Style Template(s).
      
      INSTRUCTIONS:
      1. EXTRACT STYLE BLUEPRINT: Analyze and strictly extract the visual art style, typography (font weight, color, shadow, style), color palette, lighting mood, graphic accents, and layout structure from the STYLE TEMPLATE(s).
      2. ABSOLUTE TEMPLATE ISOLATION: Do NOT copy any person (human figure/face) or any subject object (car, product, item, building, animal) from the STYLE TEMPLATE.
      3. ANALYZE SOURCE SUBJECT: Identify the main subject in the SOURCE SUBJECT image(s).
      4. EXECUTE: Place the SOURCE SUBJECT into the layout, applying the exact artistic style, typography aesthetics, color scheme, and visual vibe of the STYLE TEMPLATE.
      
      ${fidelityInstructions}
      
      ${verticalLayoutInstruction}

      ${nanoBanana2SourceInstruction}

      USER COMMAND: ${prompt}
      
      (Note: Render the provided Headline/Title prominently in Traditional Chinese, following the exact typographic style, font feel, and color palette of the template.)
    `;
    
    parts.push({ text: finalPrompt });

    const prepared = prepareAppImage({
      appModelId: String(selectedModel ?? ""),
      parts,
      systemInstruction,
      ratio: String(ratio ?? ""),
      temperature,
    });
    await streamImageResponse(res, async (signal) => ({ rawImageBase64: await runAppImage(prepared, signal) }));
  } catch (error) {
    sendImageError(res, "generate-collage", error);
  }
});

// API: Process Local Mask-based/Reflective Image Editing via Tokyo Cloud Run server proxy
app.post("/api/edit-image", async (req, res) => {
  try {
    const {
      imageUrl,
      maskBase64,
      prompt,
      isMultiMask,
      selectedModel,
      sourceAspect,
      temperature,
      extraImageBase64
    } = req.body;

    const parts: ImagePart[] = [];
    
    const systemInstruction = `
      ROLE: Expert Professional Photo Retoucher.
      TASK: Perform precise local edits based on user instructions, selection mask, and optional reference assets.
      
      STRICT RULES:
      1. MASK ADHERENCE: You will receive an image and a mask (colored strokes). The mask defines the ONLY pixels you are allowed to change.
      2. IMMUTABLE BACKGROUND: Every pixel NOT covered by the mask MUST remain 100% identical to the original. Do not hallucinate changes in the background.
      3. INVISIBLE MASK: The mask itself is metadata. Do not render the colored strokes in the final output.
      4. PHOTOREALISM: Edits must blend seamlessly with the lighting, grain, and perspective of the original photo.
      5. TEXT SAFETY: If editing text, ensure Traditional Chinese characters are rendered correctly without corruption.
      6. NO FUNCTION CALLING: Do not generate function calls. Return only the image.
    `;

    const imageAsset = await urlToAsset(imageUrl);
    parts.push({
      inlineData: {
        data: imageAsset.data,
        mimeType: imageAsset.mimeType,
      }
    });

    if (maskBase64) {
      const maskAsset = await urlToAsset(maskBase64);
      parts.push({
        inlineData: {
          data: maskAsset.data,
          mimeType: maskAsset.mimeType
        }
      });
      
      if (isMultiMask) {
        let instructions = [];
        try {
           const parsed = JSON.parse(prompt);
           instructions = parsed.map((item: any) => 
             `- MASK COLOR: ${item.name} (${item.hex}). TASK: ${item.instruction}`
           );
        } catch (e) {
           instructions = [`- TASK: ${prompt}`];
        }

        parts.push({ text: `
          [INPUTS]
          Image 1: Original Photograph.
          Image 2: Multi-color Selection Mask.
          
          [INSTRUCTIONS]
          For each color in the mask, apply the specific edit:
          ${instructions.join("\n")}
          
          [EXECUTION]
          - Identify the region under each mask color.
          - Apply the change ONLY to that region.
          - LEAVE ALL OTHER AREAS UNTOUCHED.
          - ELIMINATE TRACES: The final image must NOT show any trace of the mask colors.
        `});
      } else {
        parts.push({ text: `
          [INPUTS]
          Image 1: Original Photograph.
          Image 2: Selection Mask.
          
          [INSTRUCTION]
          - Apply this change ONLY to the masked area: "${prompt}".
          - LEAVE ALL OTHER AREAS UNTOUCHED.
          - ELIMINATE TRACES: The final image must NOT show any trace of the mask colors.
        ` });
      }
    } else {
      parts.push({ text: `Global Edit Instruction: ${prompt}. \n\nEnsure the result maintains the high quality and resolution of the original image.` });
    }

    // Fixed reference order: Image 1 base, Image 2 mask (when present), then the extra reference.
    if (extraImageBase64) {
      const extraAsset = await urlToAsset(extraImageBase64);
      const extraIndex = maskBase64 ? 3 : 2;
      parts.push({ text: `Image ${extraIndex}: Additional reference asset supplied by the user for the requested change. Use it only as a visual reference; it is not a mask.` });
      parts.push({ inlineData: { data: extraAsset.data, mimeType: extraAsset.mimeType } });
    }

    if (temperature !== undefined && (typeof temperature !== "number" || !Number.isFinite(temperature))) {
      return res.status(400).json({ error: "temperature 必須是數字。", details: { code: "invalid_request" } });
    }
    const appModelId = String(selectedModel ?? "");
    const prepared = prepareAppImage({
      appModelId,
      parts,
      systemInstruction,
      ratio: typeof sourceAspect === "string" ? sourceAspect : "1:1",
      keepInputAspect: true,
      // Explicit edit temperatures (logo replacement uses 0.5) are validated; otherwise 0.7 where supported.
      temperature: temperature ?? (imageModelView(appModelId)?.temperature ? EDIT_TEMPERATURE : undefined),
    });
    await streamImageResponse(res, async (signal) => ({ rawImageBase64: await runAppImage(prepared, signal) }));
  } catch (error) {
    sendImageError(res, "edit-image", error);
  }
});

// Configure development / production pipeline
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
  server.requestTimeout = 420_000;
}

startServer();
