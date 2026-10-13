import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  handleImageRequest,
  imageErrorBody,
  imageErrorStatus,
  type ImagePart,
} from "@hk01/pi-ai-extra-image-kit/server";
import { collageImages, editImages, imageClient } from "./server/imageModels";
import { OUTPUT_SPECS, outputSpec } from "./shared/imageOutput";

const app = express();
const PORT = 3000;

// Increase payload size limits for base64 image transfers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/** A base64 data URL as an image part, or null for anything else (other URLs are never fetched). */
const inlineImage = (dataUrl: unknown): ImagePart | null => {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl.trim());
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
};

/** Errors found before streaming starts go back as JSON; validation errors keep their HTTP status. */
const sendImageError = (res: express.Response, route: string, error: unknown) => {
  console.error(`[PROXY ERROR] ${route} failed:`, error);
  if (res.headersSent) return;
  res.status(imageErrorStatus(error)).json(imageErrorBody(error));
};

// API: Check config if api key is present on the server
app.get("/api/config", (req, res) => {
  const hasKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  res.json({ hasApiKey: hasKey });
});

// API: Image models for one route-owned scope (?scope=collage | edit)
app.get("/api/image-models", (req, res) => {
  const scope = typeof req.query.scope === "string" ? req.query.scope : "";
  try {
    res.json({ models: imageClient.forScope(scope).listModels() });
  } catch (error) {
    res.status(400).json(imageErrorBody(error));
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
      eraseText,
      titleConfig,
      selectedModel,
      temperature = 0.7,
      prohibitPretrainedData = true
    } = req.body;

    if (!(String(ratio) in OUTPUT_SPECS)) {
      return res.status(400).json({ error: `不支援的圖片比例「${ratio}」。`, details: { code: "invalid_request" } });
    }

    const parts: ImagePart[] = [];

    if (templateAssets && templateAssets.length > 0) {
      templateAssets.forEach((tmpl: any, idx: number) => {
        parts.push({
          inlineData: {
            data: tmpl.data,
            mimeType: tmpl.mimeType,
          }
        });
        parts.push({ text: `REFERENCE IMAGE ${idx + 1} (STYLE TEMPLATE): Use this image STRICTLY for branding, layout structure, fonts, and color palette. Do NOT copy the person from this image.` });
      });
    }

    const templateCount = templateAssets ? templateAssets.length : 0;
    if (sourceAssets) {
      sourceAssets.forEach((img: any, index: number) => {
        parts.push({
          inlineData: {
            data: img.data,
            mimeType: img.mimeType,
          }
        });
        parts.push({ text: `REFERENCE IMAGE ${index + 1 + templateCount} (SOURCE SUBJECT): This contains the Main Subject for the collage.` });
      });
    }

    let compositingRule = `4. COMPOSITING METHOD: Treat the subject in the Source Image as a "Cut-out Asset". Isolate the subject (remove original background if needed) and composite them into the new background defined by the Style Template(s).`;
    if (preserveBackground) {
        compositingRule = `4. COMPOSITING METHOD: Treat the entire Source Image (Subject + Background) as a single flat asset. DO NOT remove the background. Composite the WHOLE rectangular image into the layout defined by the Style Template(s). Treat it like placing a photo print onto a poster.`;
    } else if (removeBackground) {
        compositingRule = `4. COMPOSITING METHOD: STRICT BACKGROUND REMOVAL. You MUST remove the background from the Source Image completely. Extract the subject with precision (hair, edges) and place ONLY the subject onto the new layout. Do not carry over any pixels from the original background.`;
    }

    let logoInstruction = "";
    if (copyLogo && prohibitLogo) {
      logoInstruction = `
         3. LOGO HANDLING (HYBRID MODE): 
         - PRIMARY DIRECTIVE: The user wants to use the *real* logo from the template, but strictly forbids *hallucinated* or *generated* text.
         - ACTION 1 (COPY): DETECT the brand logo in the STYLE TEMPLATE. Copy/Composite this exact pixel region onto the output.
         - ACTION 2 (NO HALLUCINATION): Do NOT attempt to "draw" or "write" the logo (e.g. "HK01") using diffusion generation. If you cannot copy the pixels directly, leave the area BLANK.
         - SUMMARY: Real logo pixels OR empty space. No generated text.
      `;
    } else if (copyLogo) {
      logoInstruction = `
         3. LOGO HANDLING (COPY MODE): 
         - The user has EXPLICITLY requested to use the brand logo found in the STYLE TEMPLATE.
         - DETECT any brand logo in the provided STYLE TEMPLATE (usually top-left or top-right corners).
         - COPY/COMPOSITE that exact logo onto the generated image in the same position and aspect ratio.
      `;
    } else if (prohibitLogo) {
      logoInstruction = `
         3. STRICT LOGO & WATERMARK CLEANING:
         - TARGET: Specific media watermarks (e.g., "香港01", "HK01", "01") often appear in the top-left or top-right corners of the Style Templates.
         - ACTION: You MUST NOT generate these logos in the output.
         - CLEANUP: If the style template mimics a news layout with a corner logo, replace that logo with EMPTY SPACE or extend the BACKGROUND PATTERN.
         - PROHIBITION: Do not attempt to spell "香港01" or generate similar shaped blue/white icons. Keep the corners clean unless the User Prompt asks for a specific title.
      `;
    } else {
      logoInstruction = "3. LOGO HANDLING: The user has no specific preference for logos. You may follow the style template naturally.";
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
    
    const subjectIntegrityInstruction = `
         7. SUBJECT INTEGRITY & HALLUCINATION PREVENTION (CRITICAL):
         - NO NEW PEOPLE: You are strictly PROHIBITED from generating new people, bystanders, crowds, or extra characters. The output must contain ONLY the subject(s) provided in the Source Image.
         - PIXEL COPY: Treat the Source Subject as a digital cutout. Copy their pixels exactly.
         - POSE LOCK: Do NOT change the subject's pose, hand gestures, or body language. If they are standing, keep them standing. If they are looking left, keep them looking left.
         - EXPRESSION LOCK: Do NOT change the subject's facial expression. Do NOT make them smile if they are serious.
    `;

    const pretrainingInstruction = prohibitPretrainedData
      ? `
         10. STRICT PRE-TRAINED DATA RESTRICTION PROTOCOL (ACTIVE):
         - PROHIBIT EXTERNAL PRE-TRAINED ASSETS: You are STRICTLY FORBIDDEN from drawing upon or generating external brand logos, proprietary characters, trademarks, or visual objects from your pre-trained model database that are NOT explicitly provided in the user's input images or templates.
         - EXCLUSIVE BOUNDARY: Derive all visual subjects, logos, branding elements, and entities 100% EXCLUSIVELY from the provided input files. Do NOT synthesize unrequested third-party brands or unprovided real-world entities.
      `
      : `
         10. PRE-TRAINED DATA PERMITTED:
         - You are allowed to draw upon pre-trained database knowledge to flexibly enhance background environment, contextual objects, or generic real-world concepts beyond the uploaded assets as appropriate.
      `;

    const systemInstruction = strictFidelity 
      ? `ROLE: Expert Digital Retoucher & Compositor.
         GOAL: Composite the Source Subject into the layout defined by the Style Template(s) with 100% pixel-perfect fidelity to the subject's face/body/identity.
         
         CORE DIRECTIVE: PRESERVE CHARACTER CONSISTENCY AT ALL COSTS.
         
         STRICT RULES:
         1. FACE LOCK: The facial features (eyes, nose, mouth, shape) must be IDENTICAL to the source. Do not "re-imagine", "beautify" or "cartoonify" the person.
         2. ANGLE LOCK: The head angle and camera perspective must match the source image exactly. Do not rotate the head. If the source looks left, the result looks left.
         3. EXPRESSION LOCK: Preserve the exact facial expression.
         ${logoInstruction}
         4. STYLE MATCHING: Adopt the color grading and lighting of the template, but apply it to the source subject naturally.
         ${textInstruction}
         6. NO BORDERS: Do NOT generate decorative borders, frames, or strokes around the final image unless explicitly requested by the user.
         ${subjectIntegrityInstruction}
         ${textCleaningInstruction}
         ${specificTitleInstruction}
         ${pretrainingInstruction}
         
         If the user prompt conflicts with the source image's reality (e.g. "make him smile" when he is frowning), IGNORE the prompt and PRESERVE the source.`
      : `ROLE: Expert Creative Director & Graphic Designer.
         GOAL: Create high-impact Open Graph (OG) social media images by mimicking the visual style of the provided STYLE TEMPLATES.
         
         STYLE INSTRUCTIONS:
         - ANALYZE: deeply analyze the fonts, color palette, graphic overlays, and layout density of the REFERENCE STYLE TEMPLATES.
         - MIMIC: Apply this exact aesthetic to the SOURCE SUBJECT.
         - TYPOGRAPHY: If text is requested, use fonts that match the vibe of the templates.
         
         ${logoInstruction}
         ${textInstruction}
         ${subjectIntegrityInstruction}
         ${textCleaningInstruction}
         ${specificTitleInstruction}
         ${pretrainingInstruction}
         
         NEGATIVE CONSTRAINTS:
         - Do NOT generate specific news brand logos (e.g. HK01) from the template unless explicitly instructed.
         - NO BORDERS: Do NOT generate decorative borders, frames, or strokes around the final image unless explicitly requested.
         - NO EXTRA PEOPLE: Do not hallucinate crowds or other people.
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
        1. PRESERVE SUBJECT: Keep the identity and main features of the person in the SOURCE SUBJECT image recognizable.
        2. NO EXTRA PEOPLE: Do not add any other humans to the composition.
        3. ${compositingRule}
      `;

    const finalPrompt = `
      TASK: Generate a professional Open Graph image based on the uploaded templates.
      
      INSTRUCTIONS:
      1. EXTRACT STYLE: Extract the visual language (colors, graphics, fonts, layout density) from the STYLE TEMPLATE(s).
      2. ANALYZE SUBJECT: Identify the main subject in the SOURCE SUBJECT image(s).
      3. EXECUTE: Create a new image that places the SOURCE SUBJECT into a context heavily inspired by the STYLE TEMPLATE.
      
      ${fidelityInstructions}
      
      USER COMMAND: ${prompt}
      
      (Note: If the user provided a specific Headline/Title in the command, ensure it is prominent, legible in Traditional Chinese, and follows the style of the template.)
    `;
    
    parts.push({ text: finalPrompt });

    // One attempt with the selected provider/model: no fallback model and no retry.
    const appModelId = String(selectedModel ?? "");
    await handleImageRequest(
      res,
      collageImages,
      {
        appModelId,
        parts,
        systemInstruction,
        // The ratio preset ("16:9", "300x250", …): image-kit sends the model's exact ratio or the
        // nearest one, and the browser centre-crops the result to the exact output size.
        aspectRatio: String(ratio),
        resolution: outputSpec(String(ratio)).resolution,
        // Only models that accept temperature get the slider value (the UI disables it for the others).
        temperature: collageImages.findModel(appModelId)?.temperature ? temperature : undefined,
      },
      async (image) => ({ imageUrl: image.dataUrl }),
    );
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
      sourceAspect
    } = req.body;

    const parts: ImagePart[] = [];
    
    const systemInstruction = `
      ROLE: Expert Professional Photo Retoucher.
      TASK: Perform precise local edits based on user instructions and a selection mask.
      
      STRICT RULES:
      1. MASK ADHERENCE: You will receive an image and a mask (colored strokes). The mask defines the ONLY pixels you are allowed to change.
      2. IMMUTABLE BACKGROUND: Every pixel NOT covered by the mask MUST remain 100% identical to the original. Do not hallucinate changes in the background.
      3. INVISIBLE MASK: The mask itself is metadata. Do not render the colored strokes in the final output.
      4. PHOTOREALISM: Edits must blend seamlessly with the lighting, grain, and perspective of the original photo.
      5. TEXT SAFETY: If editing text, ensure Traditional Chinese characters are rendered correctly without corruption.
      6. NO FUNCTION CALLING: Do not generate function calls. Return only the image.
    `;

    // Images arrive as data URLs from the browser; any other URL is refused, never fetched.
    const baseImage = inlineImage(imageUrl);
    const maskImage = maskBase64 ? inlineImage(maskBase64) : null;
    if (!baseImage || (maskBase64 && !maskImage)) {
      return res.status(400).json({ error: "圖片必須以 base64 data URL 傳送。", details: { code: "invalid_request" } });
    }
    parts.push(baseImage);

    if (maskBase64) {
      parts.push(maskImage!);
      
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

    // One attempt with the selected provider/model: no fallback model and no retry.
    await handleImageRequest(
      res,
      editImages,
      {
        appModelId: String(selectedModel ?? ""),
        parts,
        systemInstruction,
        // The original image's "width:height": the nearest ratio is sent when the model cannot keep
        // the input aspect by itself, and the browser crops the result back to the original size.
        aspectRatio: typeof sourceAspect === "string" ? sourceAspect : undefined,
        keepInputAspect: true,
        // Edits have always requested 1K.
        resolution: "1K",
      },
      async (image) => ({ imageUrl: image.dataUrl }),
    );
  } catch (error) {
    sendImageError(res, "edit-image", error);
  }
});

// Global Express error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[EXPRESS ERROR]", err);
  res.status(err.status || 500).json({ error: err.message || "Server payload or parsing error" });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
