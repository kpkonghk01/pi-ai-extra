import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  handleImageRequest,
  imageErrorBody,
  imageErrorStatus,
  type ImagePart,
} from "@hk01/pi-ai-extra-image-kit/server";
import { editImages, generateImages, imageClient } from "./server/imageModels";

dotenv.config();

/** A base64 data URL as an inline image part, keeping its real type (deep-edit results are PNG). */
function inlineImage(dataUrl: string): ImagePart {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
  // Bare base64 without a data URL header.
  return { inlineData: { mimeType: "image/jpeg", data: dataUrl } };
}

/** Errors found before streaming starts go back as JSON; validation errors keep their HTTP status. */
function sendImageError(res: express.Response, route: string, error: unknown) {
  console.error(`API ${route} error:`, error);
  if (res.headersSent) return;
  res.status(imageErrorStatus(error)).json(imageErrorBody(error));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Helper to initialize Gemini SDK (text analysis only; images go through image-kit)
  const getAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY 未於伺服器環境變數中設定。請在設定中確認金鑰。");
    }
    return new GoogleGenAI({ apiKey });
  };

  // Image models for one route-owned scope (?scope=generate | edit)
  app.get("/api/image-models", (req, res) => {
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";
    try {
      res.json({ models: imageClient.forScope(scope).listModels() });
    } catch (error) {
      res.status(400).json(imageErrorBody(error));
    }
  });

  // 1. Analyze OG Prompt Endpoint
  app.post("/api/analyze-og", async (req, res) => {
    try {
      const {
        promptText,
        activeTemplate,
        sourceImages = [],
        brandLogo,
        reasoningModel = "gemini-3.8-flash"
      } = req.body;
      const ai = getAI();

      const parts: ImagePart[] = [
        { text: promptText }
      ];

      if (activeTemplate) {
        parts.push({ text: "【最高基準：樣板圖片 (Design, Typography & Aesthetic Style Template)】：\n這是排版佈局、主標題字體風格、文字色彩與整體美術調性的最高基準。請深入分析其字體外觀（字重粗細、文字顏色、是否有描邊綑邊、是否有底襯）與設計風格。" });
        parts.push(inlineImage(activeTemplate));
      }

      sourceImages.forEach((img: string, i: number) => {
        parts.push({ text: `【素材圖片第 ${i + 1} 張 (Source Image - 人物/主體內容)】:` });
        parts.push(inlineImage(img));
      });

      if (brandLogo) {
        parts.push({ text: "【用戶提供的新 Logo (優先使用於樣板指定位置)】:" });
        parts.push(inlineImage(brandLogo));
      }

      // One attempt with the requested model: no retry, no fallback model.
      const analyzerResult = await ai.models.generateContent({
        model: reasoningModel || "gemini-3.8-flash",
        contents: [{ parts }],
      });

      res.json({ refinedPrompt: analyzerResult.text });
    } catch (error: any) {
      console.error("API /api/analyze-og error:", error);
      const errMsg = error?.message || String(error);
      if (errMsg.includes("User location is not supported")) {
        return res.status(400).json({
          error: "地區連線限制 (User location is not supported)。請確認伺服器環境部署位置或稍後重試。",
        });
      }
      res.status(500).json({ error: errMsg });
    }
  });

  // 2. Generate OG Image Endpoint (scope "generate")
  app.post("/api/generate-og-image", async (req, res) => {
    try {
      const {
        model,
        generatorPrompt,
        activeTemplate,
        sourceImages = [],
        brandLogo,
        temperature,
        ratio,
      } = req.body;
      const appModelId = String(model ?? "");

      const parts: ImagePart[] = [
        { text: generatorPrompt }
      ];

      if (activeTemplate) {
        parts.push({ text: "【樣板圖片 (Design, Typography & Style Blueprint)】：\n這是排版與標題字體外觀基準。請參考此圖的文字色彩與排版位置。若生成指令要求零描邊純平字體，標題文字必須呈現為純平向量實心色塊（Flat solid vector fill typography, borderless），描邊寬度強制為 0 像素。" });
        parts.push(inlineImage(activeTemplate));
      }

      sourceImages.forEach((img: string, i: number) => {
        parts.push({ text: `【素材圖片第 ${i + 1} 張 (Source Image - 提取主體人物/產品內容)】:` });
        parts.push(inlineImage(img));
      });

      if (brandLogo) {
        parts.push({ text: "【用戶指定品牌 Logo (精準置於樣板指定位置)】:" });
        parts.push(inlineImage(brandLogo));
      }

      await handleImageRequest(
        res,
        generateImages,
        {
          appModelId,
          parts,
          // The UI ratio id ("16:9", "300x250", …). image-kit sends the model's exact ratio or the
          // nearest one; the browser crops the result to the exact output size.
          aspectRatio: String(ratio ?? ""),
          resolution: "1K",
          // Only models that accept temperature get the slider value (the UI disables it otherwise).
          temperature: generateImages.findModel(appModelId)?.temperature ? temperature : undefined,
        },
        async (image) => ({ imageUrl: image.dataUrl }),
      );
    } catch (error) {
      sendImageError(res, "/api/generate-og-image", error);
    }
  });

  // 3. Deep Edit Endpoint (scope "edit"; also used by AI logo erase)
  app.post("/api/deep-edit", async (req, res) => {
    try {
      const { base64Data, promptText, model, aspectRatio } = req.body;
      const appModelId = String(model ?? "");

      await handleImageRequest(
        res,
        editImages,
        {
          appModelId,
          parts: [inlineImage(String(base64Data ?? "")), { text: promptText }],
          // The canvas "width:height"; used when the model cannot keep the input aspect by itself.
          aspectRatio: typeof aspectRatio === "string" ? aspectRatio : undefined,
          keepInputAspect: true,
          resolution: "1K",
        },
        async (image) => ({ imageUrl: image.dataUrl }),
      );
    } catch (error) {
      sendImageError(res, "/api/deep-edit", error);
    }
  });

  // Vite middleware for dev or static serving for prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
