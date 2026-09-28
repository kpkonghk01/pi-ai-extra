import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { generateOpenRouterImage } from "./server/providers/openrouter";
import { generateToAPIsImage } from "./server/providers/toapis";
import { generateKieImage } from "./server/providers/kie";
import { generateAppImage, partsToPrompt } from "./server/providers/imageClient";
import { isToapisModel, isOpenRouterModel, isKieModel } from "./src/models.config";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up JSON body parser with increased limit for base64 images
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Helper to convert base64 data URL or remote URL to inlineData format for Gemini SDK
const getInlineData = async (dataUrlOrUrl: string) => {
  if (!dataUrlOrUrl) {
    throw new Error("Empty image input provided");
  }

  // Handle remote HTTP/HTTPS image URL
  if (dataUrlOrUrl.startsWith("http://") || dataUrlOrUrl.startsWith("https://")) {
    try {
      const response = await fetch(dataUrlOrUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/*, */*"
        },
        signal: AbortSignal.timeout(20000)
      });
      if (response.ok) {
        const contentType = response.headers.get("content-type") || "image/jpeg";
        const buffer = Buffer.from(await response.arrayBuffer());
        return {
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: contentType.split(";")[0],
          }
        };
      }
    } catch (e) {
      console.warn("Failed to fetch remote image in getInlineData:", e);
    }
  }

  // Handle Base64 Data URL (data:image/xxx;base64,...)
  if (dataUrlOrUrl.includes(",")) {
    const [header, data] = dataUrlOrUrl.split(',');
    const mimeType = header.includes(":") ? header.split(':')[1].split(';')[0] : "image/jpeg";
    return {
      inlineData: {
        data: data.trim(),
        mimeType: mimeType || "image/jpeg",
      },
    };
  }

  // Fallback for raw base64 string
  return {
    inlineData: {
      data: dataUrlOrUrl.trim(),
      mimeType: "image/jpeg",
    },
  };
};

// API Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now(), uptime: Math.round(process.uptime()) });
});

// Image proxy route to prevent canvas CORS contamination
app.get("/api/proxy-image", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send("Missing url parameter");
  }

  try {
    let response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/*, */*"
      }
    });

    if (!response.ok && (response.status === 403 || response.status === 401)) {
      // Retry without custom User-Agent (for Azure blob / S3 presigned URLs that reject unknown User-Agents)
      response = await fetch(imageUrl, {
        headers: { "Accept": "image/*, */*" }
      });
    }

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch remote image: ${response.statusText}`);
    }

    let contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length >= 4) {
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        contentType = "image/png";
      } else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        contentType = "image/jpeg";
      } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        contentType = "image/webp";
      }
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(buffer);
  } catch (err: any) {
    console.error("Proxy image error:", err);
    return res.status(500).send("Proxy image failed");
  }
});

// Helper for Keep-Alive Streaming Ping (NDJSON) to prevent 60s proxy/Cloud Run idle timeouts
function createResponseSender(req: express.Request, res: express.Response) {
  const wantsStream = req.headers['x-stream-progress'] === 'true' || 
                      req.headers.accept?.includes('application/x-ndjson');

  if (!wantsStream) {
    return {
      sendSuccess: (imageUrl: string) => {
        if (!res.headersSent) {
          res.json({ imageUrl });
        }
      },
      sendError: (status: number, error: string) => {
        if (!res.headersSent) {
          res.status(status).json({ error });
        }
      },
    };
  }

  // Streaming NDJSON mode with anti-buffering headers
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // Immediately send start chunk to establish streaming HTTP connection in <50ms
  res.write(JSON.stringify({ type: 'start', message: '處理中...' }) + '\n');
  if (typeof (res as any).flush === 'function') (res as any).flush();

  const startTime = Date.now();
  const pingInterval = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(pingInterval);
      return;
    }
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    try {
      res.write(JSON.stringify({ type: 'ping', elapsedSec, message: `運算生成中 (${elapsedSec}s)...` }) + '\n');
      if (typeof (res as any).flush === 'function') (res as any).flush();
    } catch (_) {}
  }, 8000); // 8-second interval ensures connection never idles to 60s

  res.on('close', () => {
    clearInterval(pingInterval);
  });

  return {
    sendSuccess: (imageUrl: string) => {
      clearInterval(pingInterval);
      if (!res.writableEnded && !res.destroyed) {
        console.log(`[ResponseSender] Sending complete event. Image data length: ${imageUrl?.length || 0}`);
        res.write(JSON.stringify({ type: 'complete', imageUrl }) + '\n');
        if (typeof (res as any).flush === 'function') (res as any).flush();
        res.end();
      }
    },
    sendError: (_status: number, error: string) => {
      clearInterval(pingInterval);
      if (!res.writableEnded && !res.destroyed) {
        console.warn(`[ResponseSender] Sending error event: ${error}`);
        res.write(JSON.stringify({ type: 'error', error }) + '\n');
        if (typeof (res as any).flush === 'function') (res as any).flush();
        res.end();
      }
    },
  };
}

app.post("/api/gemini/generate", async (req, res) => {
  const sender = createResponseSender(req, res);
  const clientAbortController = new AbortController();

  res.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[Generate API] Client connection closed before response completed. Aborting server task.`);
      clientAbortController.abort();
    }
  });

  try {
    if (!req.body || typeof req.body !== 'object') {
      return sender.sendError(400, "無效的請求內容 (Invalid request body)");
    }

    const {
      templateImage,
      sourceImages,
      brandLogo,
      lockTemplateLogo = true,
      globalPrompt,
      ratioPrompt,
      ratio = '16:9',
      modelId = 'nano-banana-2',
      imageQuality = '1K',
      subjectFitMode = 'crop-zoom',
      keepSourceBackground = true,
    } = req.body;

    const safeModelId = String(modelId || 'nano-banana-2').trim();

    if (isToapisModel(safeModelId)) {
      try {
        console.log(`[Generate] Routing request to ToAPIs with model: ${safeModelId}, quality: ${imageQuality}, keepSourceBackground: ${keepSourceBackground}`);
        const imageUrl = await generateToAPIsImage({
          modelId: safeModelId,
          globalPrompt,
          ratioPrompt,
          ratio,
          templateImage,
          sourceImages,
          brandLogo,
          lockTemplateLogo,
          imageQuality,
          subjectFitMode,
          keepSourceBackground,
          signal: clientAbortController.signal,
        });
        return sender.sendSuccess(imageUrl);
      } catch (err: any) {
        if (res.writableEnded || res.destroyed) {
          console.log(`[Generate] Client socket already closed, cancelled response.`);
          return;
        }
        console.error(`[Generate] ToAPIs error for ${safeModelId}:`, err);
        return sender.sendError(500, err.message || `${safeModelId} (ToAPIs) 生成失敗`);
      }
    }

    if (isKieModel(safeModelId)) {
      try {
        console.log(`[Generate] Routing request to KIE with model: ${safeModelId}, quality: ${imageQuality}, keepSourceBackground: ${keepSourceBackground}`);
        const imageUrl = await generateKieImage({
          modelId: safeModelId,
          globalPrompt,
          ratioPrompt,
          ratio,
          templateImage,
          sourceImages,
          brandLogo,
          lockTemplateLogo,
          imageQuality,
          subjectFitMode,
          keepSourceBackground,
          signal: clientAbortController.signal,
        });
        return sender.sendSuccess(imageUrl);
      } catch (err: any) {
        console.error(`[Generate] KIE error for ${safeModelId}:`, err);
        return sender.sendError(500, err.message || `${safeModelId} (KIE) 生成失敗`);
      }
    }

    if (isOpenRouterModel(safeModelId)) {
      try {
        const imageUrl = await generateOpenRouterImage({
          globalPrompt,
          ratioPrompt,
          ratio,
          templateImage,
          sourceImages,
          brandLogo,
          lockTemplateLogo,
          subjectFitMode,
          keepSourceBackground,
        });
        return sender.sendSuccess(imageUrl);
      } catch (err: any) {
        return sender.sendError(500, err.message || "GPT Image 2 (OpenRouter) 生成失敗");
      }
    }


    if (!templateImage) {
      return sender.sendError(400, "Missing templateImage");
    }
    if (!sourceImages || !Array.isArray(sourceImages) || sourceImages.length === 0) {
      return sender.sendError(400, "Missing or empty sourceImages");
    }

    const parts: any[] = [];

    // Add template image
    parts.push({ text: "STYLE TEMPLATE (Reference for layout, typography, colors, and overall vibe ONLY. CLEAN SLATE: Do NOT include any people, text, or specific objects from this reference style image in the final output):" });
    parts.push(await getInlineData(templateImage));

    // Add source images
    const sourceCount = sourceImages.length;
    const multiImageCollageMandate = sourceCount > 1 ? `
CRITICAL MANDATE - ALL ${sourceCount} SOURCE IMAGES MUST BE INCLUDED IN A MULTI-IMAGE COLLAGE:
- You are provided with ${sourceCount} distinct source images.
- MANDATORY INCLUSION: You MUST incorporate EVERY SINGLE ONE of the ${sourceCount} source images into the final output composition.
- STRICTLY FORBIDDEN: It is STRICTLY FORBIDDEN to pick only the first image, ignore any image, or omit any image. ALL ${sourceCount} source subjects must appear distinctly and harmoniously in the final collage.
- COLLAGE COMPOSITION: Intelligently compose a cohesive collage or multi-subject arrangement following the layout structure of the style template (e.g., split screen, side-by-side juxtaposition, dynamic photo grids, or foreground/background layering) so all ${sourceCount} subjects are clearly visible, balanced, and recognizable.
- 繁體中文排版鐵律：用戶上傳了共 ${sourceCount} 張素材圖片，必須「全部」拼貼融合進新的 OG 圖片中！嚴禁偷懶只挑選第 1 張素材，每一張素材圖片中的人物主體都必須以真實面貌同時出現在最終畫面裡。` : `
- SOURCE PRESERVATION: You MUST use the provided source image. 100% pixel-perfect preservation of the subject is required.`;

    const sourceImagesHeader = subjectFitMode === 'outpaint-fill'
      ? `SOURCE IMAGES (CRITICAL: You MUST use ALL ${sourceCount} source images. Do NOT modify their faces, expressions, features, or identities. 100% pixel-perfect preservation of the subjects is required. 【左右擴圖填滿模式】: CRITICAL ASPECT RATIO LOCK - Absolutely preserve native aspect ratio of human subjects. NEVER stretch or squash faces/bodies horizontally. Keep subject in natural proportion and seamlessly extend background outwards):`
      : `SOURCE IMAGES (CRITICAL: You MUST use ALL ${sourceCount} source images. Do NOT modify their faces, expressions, features, or identities. 100% pixel-perfect preservation of the subjects is required. 【局部裁切特寫模式】: CRITICAL ASPECT RATIO LOCK - Absolutely preserve native aspect ratio of human subjects. NEVER stretch or squash faces/bodies horizontally. Scale subjects proportionally and crop non-essential outer edges while keeping faces crisp and undistorted):`;
    parts.push({ text: sourceImagesHeader });
    for (let idx = 0; idx < sourceImages.length; idx++) {
      const img = sourceImages[idx];
      parts.push({ text: `Source Image 第${idx + 1}張 (共 ${sourceCount} 張，第 ${idx + 1} 位必選主體，必須出現在拼貼中):` });
      parts.push(await getInlineData(img));
    }

    // Add brand logo if exists
    if (brandLogo) {
      parts.push({ text: "BRAND LOGO (CRITICAL: 100% pixel-perfect copy of this uploaded logo. Place it in the top left or top right corner as appropriate for the layout. STRICTLY do NOT guess or retrieve logos from database or web):" });
      parts.push(await getInlineData(brandLogo));
    } else if (lockTemplateLogo !== false) {
      parts.push({ text: `BRAND LOGO (CRITICAL: PIXEL-PERFECT LOCK & CLONE FROM STYLE TEMPLATE):
- 1. 嚴禁使用圖片模型或大模型訓練數據庫中的資料及舊品牌Logo去生成新圖片的Logo (STRICTLY FORBIDDEN from using training data, internal memory, or obsolete database logos).
- 2. 嚴格禁止模型啟動web search去尋找互聯網上的Logo用作生成 (STRICTLY FORBIDDEN from searching the web for logos).
- 3. 像素級鎖定「樣板圖片」中的品牌Logo並複製它到新生成的圖片中 (PIXEL-PERFECT LOCK & CLONE: Identify the exact brand logo in the style template and reproduce it 100% identically in typography, color, emblem, and ratio).` });
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

    const logoRule = (lockTemplateLogo !== false)
      ? `6. 像素級鎖定複製品牌Logo (CRITICAL MANDATE - PIXEL-PERFECT BRAND LOGO LOCK & CLONE):
   - 1）嚴禁使用圖片模型或大模型訓練數據庫中的資料及舊品牌Logo去生成新圖片的Logo。(STRICTLY FORBIDDEN from using training data, internal memory, or obsolete database logos to generate or guess the brand logo).
   - 2）嚴格禁止模型啟動web search去尋找互聯網上的Logo用作生成。(STRICTLY FORBIDDEN from initiating or performing web search for any logo).
   - 3）像素級鎖定「樣板圖片」中的品牌Logo並複製它到新生成的圖片中。(PIXEL-PERFECT LOCK: You MUST lock onto the exact Brand Logo in the provided STYLE TEMPLATE image and clone it directly onto the new generated image with 100% pixel-perfect precision in typography, symbol, graphics, colors, aspect ratio, and layout).`
      : `6. LOGO: Ensure the brand logo is perfectly copied and placed in the top left or top right.`;

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

    const backgroundRule = (keepSourceBackground !== false)
      ? `8. CRITICAL MANDATE: 嚴格沿用素材圖片背景並允許無縫融合 (PRESERVE SOURCE IMAGE BACKGROUND & ALLOW SEAMLESS BLENDING):
   - 1）嚴禁模型脫離素材自行創作背景：嚴格禁止模型為生成的新 OG 圖片自行構思、想像或創作任何脫離素材的新背景 (STRICTLY FORBIDDEN from hallucinating, generating, or designing an arbitrary, invented, or third-party background unrelated to the source images).
   - 2）沿用素材真實背景：必須直接保留並沿用所提供素材圖片原本的真實背景、現場環境、光影氛圍與色彩基調 (You MUST directly preserve and carry over the original, authentic background and environmental setting from the provided source images).
   - 3）容許無縫融合效果 (ALLOW SEAMLESS BLENDING)：在嚴格沿用素材背景的前提下，容許並鼓勵生成圖片時將素材圖片的背景進行自然無縫融合（Seamless Blending / Harmonious Feathering & Outpainting）。
        * 比例延展與外擴：若畫面長寬比需要擴展（如橫向 16:9 或直向 9:16），允許基於素材原本的背景紋理與環境色調進行向外自然延展與無縫擴圖（Seamless Outpainting），避免黑邊或生硬裁切；
        * 多素材背景平滑融合：若上傳了多張素材圖片，各人物主體的原生背景之間必須互相進行平滑漸變羽化過渡，融合成整體和諧、無生硬拼貼切痕的完整背景；
        * 標題排版留白過渡：背景在文字排版區域可進行自然的漸層羽化微調，以確保文字清晰可讀，但背景基調依然必須完全承襲自素材的原生背景。
   - 4）繁體中文排版鐵律：絕對禁止模型為生成的新 OG 自行創作不相干的新背景！但容許生成圖片時將素材圖片的背景做無縫融合效果，既忠實於素材背景，又渾然天成。`
      : `8. BACKGROUND DESIGN: You may harmonize or design an appropriate background setting according to the style template and typography needs.`;

    const fullPrompt = `
You are an expert Open Graph image creator and collage master.
Your task is to create a new Open Graph image based on the provided STYLE TEMPLATE and SOURCE IMAGES.

CRITICAL RULES:
1. CLEAN SLATE: Do NOT include any people, text, or specific objects from the reference style image. The style image is ONLY for layout, typography, colors, and vibe.
2. SOURCE PRESERVATION & MANDATORY MULTI-IMAGE COLLAGE:
${multiImageCollageMandate}
${subjectFitRule}
${backgroundRule}
4. TEXT PLACEMENT: Ensure the text title does NOT obscure the main subjects (especially faces) or important objects.
5. LANGUAGE: The title and any text must be in Traditional Chinese (繁體中文).
${logoRule}
${adBannerRules}
Global Instructions & Title:
${globalPrompt}

Specific Layout Instructions for this ratio (${ratio}):
${ratioPrompt}
`;

    parts.push({ text: fullPrompt });

    // Gemini generation via @hk01/pi-ai-extra-google: the labelled parts above become one prompt with numbered image markers.
    const { prompt: geminiPrompt, referenceImages: geminiImages } = partsToPrompt(parts);
    const imageUrl = await generateAppImage({
      appModelId: safeModelId,
      prompt: geminiPrompt,
      referenceImages: geminiImages,
      ratio,
      quality: imageQuality === "2K" ? "2K" : "1K",
      signal: clientAbortController.signal,
    });
    return sender.sendSuccess(imageUrl);

  } catch (error: any) {
    console.error("Error in generate API:", error);
    let errorMsg = error?.message || "伺服器處理錯誤";
    if (typeof errorMsg === 'string' && errorMsg.startsWith('{') && errorMsg.includes('"message"')) {
      try {
        const parsed = JSON.parse(errorMsg);
        errorMsg = parsed?.error?.message || parsed?.message || errorMsg;
      } catch (_) {}
    }
    sender.sendError(500, errorMsg);
  }
});

// API Endpoint for editing OG image
app.post("/api/gemini/edit", async (req, res) => {
  const sender = createResponseSender(req, res);
  const clientAbortController = new AbortController();

  res.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[Edit API] Client connection closed before response completed. Aborting ongoing edit.`);
      clientAbortController.abort();
    }
  });

  try {
    if (!req.body || typeof req.body !== 'object') {
      return sender.sendError(400, "無效的請求內容 (Invalid request body)");
    }

    const {
      baseImage,
      editPrompt,
      ratio = '16:9',
      modelId = 'nano-banana-2',
      imageQuality = '1K',
    } = req.body;

    const safeModelId = String(modelId || 'nano-banana-2').trim();

    if (isToapisModel(safeModelId)) {
      try {
        console.log(`[Edit] Routing request to ToAPIs with model: ${safeModelId}, quality: ${imageQuality}`);
        const imageUrl = await generateToAPIsImage({
          modelId: safeModelId,
          editPrompt,
          ratio,
          baseImage,
          imageQuality,
          signal: clientAbortController.signal,
        });
        return sender.sendSuccess(imageUrl);
      } catch (err: any) {
        if (res.writableEnded || res.destroyed) {
          console.log(`[Edit] Client socket already closed, cancelled response.`);
          return;
        }
        console.error(`[Edit] ToAPIs error for ${safeModelId}:`, err);
        return sender.sendError(500, err.message || `${safeModelId} (ToAPIs) 編輯失敗`);
      }
    }

    if (isKieModel(safeModelId)) {
      try {
        console.log(`[Edit] Routing request to KIE with model: ${safeModelId}, quality: ${imageQuality}`);
        const imageUrl = await generateKieImage({
          modelId: safeModelId,
          editPrompt,
          ratio,
          baseImage,
          imageQuality,
        });
        return sender.sendSuccess(imageUrl);
      } catch (err: any) {
        console.error(`[Edit] KIE error for ${safeModelId}:`, err);
        return sender.sendError(500, err.message || `${safeModelId} (KIE) 編輯失敗`);
      }
    }

    if (isOpenRouterModel(safeModelId)) {
      try {
        const imageUrl = await generateOpenRouterImage({
          editPrompt,
          ratio,
        });
        return sender.sendSuccess(imageUrl);
      } catch (err: any) {
        return sender.sendError(500, err.message || "GPT Image 2 (OpenRouter) 編輯失敗");
      }
    }

    if (!baseImage) {
      return sender.sendError(400, "Missing baseImage");
    }
    if (!editPrompt) {
      return sender.sendError(400, "Missing editPrompt");
    }

    const parts: any[] = [];

    parts.push({ text: "ORIGINAL IMAGE TO EDIT:" });
    parts.push(await getInlineData(baseImage));

    const fullPrompt = `
You are an expert image editor. Your task is to apply the requested edits to the provided image.
CRITICAL RULES:
1. PRESERVE UNMARKED AREAS: Do not change any part of the image that is not explicitly mentioned in the edit instructions.
2. REMOVE STROKES: The provided image may have colored strokes or circles indicating where to edit. You MUST remove these strokes and replace them with the requested content or blend them naturally into the background.
3. FOLLOW INSTRUCTIONS: Apply the edits exactly as requested in the instructions below.
4. PRESERVE ASPECT RATIO: The output image MUST have the exact same aspect ratio as the original image. Do not crop it to a square unless the original is a square.

Edit Instructions:
${editPrompt}
`;

    parts.push({ text: fullPrompt });

    // Gemini edit via @hk01/pi-ai-extra-google: the labelled parts above become one prompt with numbered image markers.
    const { prompt: geminiPrompt, referenceImages: geminiImages } = partsToPrompt(parts);
    const imageUrl = await generateAppImage({
      appModelId: safeModelId,
      prompt: geminiPrompt,
      referenceImages: geminiImages,
      ratio,
      quality: imageQuality === "2K" ? "2K" : "1K",
      signal: clientAbortController.signal,
    });
    return sender.sendSuccess(imageUrl);

  } catch (error: any) {
    console.error("Error in edit API:", error);
    let errorMsg = error?.message || "伺服器處理錯誤";
    if (typeof errorMsg === 'string' && errorMsg.startsWith('{') && errorMsg.includes('"message"')) {
      try {
        const parsed = JSON.parse(errorMsg);
        errorMsg = parsed?.error?.message || parsed?.message || errorMsg;
      } catch (_) {}
    }
    sender.sendError(500, errorMsg);
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

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
  server.timeout = 420000;
  server.requestTimeout = 420000;
  server.keepAliveTimeout = 420000;
  server.headersTimeout = 430000;
}

startServer();
