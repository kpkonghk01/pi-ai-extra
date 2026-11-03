# opengraph2: move the Analysis step to the chat kit — part 2 of 3: Server: the Analysis step on the chat kit

You are editing this Google AI Studio app, "OpenGraph2 圖片製作大師" (opengraph2). This is **part 2 of 3**; part 1 (packages and clean-up) is already applied. Part 2 changes the server only: a new file holds the list of Analysis step models and the chat kit call, and `server.ts` uses it. Part 3 (the UI) follows in a separate message. **Do not start on it.**

Before you start, check that part 1 is applied: `package.json` must contain `@hk01/pi-ai-extra-chat-kit` and `@earendil-works/pi-ai`. If it does not, stop and say so.

## Rules

1. **Change only what the steps say.** Keep every prompt text, label, layout and style exactly as it is.
2. **No fallback and no retry.** Do not add another model, another provider or a second attempt anywhere. The user chooses; the app never chooses for them.
3. **Do not edit history.** Do not edit Markdown files (`*.md`), and do not edit anything inside a folder whose name contains `migration` (for example `pi-ai-extra-migration/`). They hold notes and snapshots from earlier migrations.
4. **A Find is exact.** Each "Find" text must occur in the file exactly the number of times the step says (once unless stated). If it does not, **stop and report which step and what you found instead.** Do not guess and do not edit something similar.
5. Copy the "Replace with" text exactly, including indentation. Do not reformat, rename or "improve" it.
6. If something does not fit the steps, describe it in your final report instead of fixing it.

## Step 2.1: Create the Analysis step model list and the chat kit call

File: `server/analysisModels.ts`

Why: One new file holds the model list the user picks from, the chat kit set-up and the one-attempt analysis call.

Create the new file `server/analysisModels.ts` with exactly this content:

```ts
import { createChatKit } from '@hk01/pi-ai-extra-chat-kit';
import { createGoogleProvider } from '@hk01/pi-ai-extra-google/pi-ai';
import { createKieProvider } from '@hk01/pi-ai-extra-kie/pi-ai';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { ImagePart } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * Analysis step models (/api/analyze-og): the text models that read the template, the source
 * images and the logo, and write the brief the image model follows. The user picks one in the
 * header. The server never changes that choice for them: no retry, no other model, no other
 * provider. The list is owned here: the browser sends a key, and an unknown key is refused.
 */
export interface AnalysisModelOption {
  /** `provider:modelId`, stored in the browser's state. */
  key: string;
  provider: 'kie' | 'google';
  /** The model id the provider's chat kit entry knows. */
  modelId: string;
  label: string;
  providerLabel: string;
  /** The server secret that holds this provider's key. */
  secret: 'KIE_API_KEY' | 'GEMINI_API_KEY';
}

/** What GET /api/analysis-models sends: never a key or a secret's value. */
export interface AnalysisModelView {
  key: string;
  label: string;
  providerLabel: string;
  available: boolean;
  reason?: string;
}

export const DEFAULT_ANALYSIS_MODEL = 'kie:gemini-3-8-flash';

const KIE = { provider: 'kie', providerLabel: 'KIE', secret: 'KIE_API_KEY' } as const;
const GOOGLE = { provider: 'google', providerLabel: 'Google', secret: 'GEMINI_API_KEY' } as const;

const OPTIONS: readonly AnalysisModelOption[] = [
  { key: 'kie:gemini-3-8-flash', modelId: 'gemini-3-8-flash', label: 'Gemini 3.8 Flash', ...KIE },
  { key: 'kie:gemini-3-6-flash', modelId: 'gemini-3-6-flash', label: 'Gemini 3.6 Flash', ...KIE },
  { key: 'kie:gemini-4-argon', modelId: 'gemini-4-argon', label: 'Gemini 4 Argon', ...KIE },
  { key: 'kie:claude-sonnet-5-5', modelId: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', ...KIE },
  { key: 'kie:gpt-6-luna', modelId: 'gpt-6-luna', label: 'GPT-6 Luna', ...KIE },
  { key: 'google:gemini-3.8-flash', modelId: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', ...GOOGLE },
];

export function findAnalysisModel(key: string): AnalysisModelOption | undefined {
  return OPTIONS.find((option) => option.key === key);
}

/** The name of the secret the server lacks for this model, if it lacks one. */
export function missingSecret(option: AnalysisModelOption, env: NodeJS.ProcessEnv): string | undefined {
  return env[option.secret]?.trim() ? undefined : option.secret;
}

export function listAnalysisModels(env: NodeJS.ProcessEnv): AnalysisModelView[] {
  return OPTIONS.map((option) => {
    const missing = missingSecret(option, env);
    return {
      key: option.key,
      label: option.label,
      providerLabel: option.providerLabel,
      available: missing === undefined,
      ...(missing === undefined ? {} : { reason: `伺服器未設定 ${missing}` }),
    };
  });
}

type ChatProviders = Parameters<typeof createChatKit>[0]['providers'];

let kit: ReturnType<typeof createChatKit> | undefined;

/**
 * The chat kit, with a provider for every key the server has. One kit for the process: the
 * secrets do not change while it runs. A request for a model whose key is missing is refused
 * before it gets here (`missingSecret`).
 */
function chatKit(env: NodeJS.ProcessEnv) {
  if (!kit) {
    const providers: ChatProviders[number][] = [];
    const kieKey = env.KIE_API_KEY?.trim();
    if (kieKey) providers.push(createKieProvider({ apiKey: kieKey }));
    const googleKey = env.GEMINI_API_KEY?.trim();
    if (googleKey) providers.push(createGoogleProvider({ apiKey: googleKey }));
    kit = createChatKit({ providers });
  }
  return kit;
}

export interface AnalysisErrorBody {
  error: string;
  details: { appModelId?: string; provider?: string; model?: string; code?: string; status?: number };
}

/** A failed analysis, with the HTTP status and the body the route answers with. */
export class AnalysisFailure extends Error {
  status: number;
  body: AnalysisErrorBody;
  constructor(status: number, body: AnalysisErrorBody) {
    super(body.error);
    this.name = 'AnalysisFailure';
    this.status = status;
    this.body = body;
  }
}

/** The HTTP status for a chat kit error code; a provider failure is a bad gateway. */
const STATUS_OF_CODE: Record<string, number> = {
  INVALID_REQUEST: 400,
  UNSUPPORTED: 400,
  UNKNOWN_MODEL: 400,
  CONTENT_BLOCKED: 422,
};

/**
 * The chat kit puts a provider's JSON error body after the status (`[kie/model] 401: {"error":...}`).
 * The modal shows the message inside it instead of the whole body.
 */
function readable(reported: string): string {
  const start = reported.indexOf('{');
  if (start > 0) {
    try {
      const body = JSON.parse(reported.slice(start));
      const inner = body?.message ?? body?.error?.message;
      if (typeof inner === 'string' && inner) return `${reported.slice(0, start).trim()} ${inner}`;
    } catch {
      // Not JSON: keep the text as it is.
    }
  }
  return reported;
}

/**
 * One analysis turn on exactly the model the user picked: one attempt, no retry, no fallback.
 * The prompt's parts (text labels and inline images, in order) become one user message.
 * Returns the model's text, or undefined when the browser closed the request (nobody to answer).
 * Throws `AnalysisFailure` when the turn fails. Logs one line: the model, how long it took and
 * the cost the provider reported.
 */
export async function runAnalysis(
  option: AnalysisModelOption,
  parts: readonly ImagePart[],
  signal: AbortSignal,
): Promise<string | undefined> {
  const content = parts.flatMap((part): (TextContent | ImageContent)[] => {
    if (part.text !== undefined) return [{ type: 'text', text: part.text }];
    // An empty image would only make the provider fail; the label before it stays.
    if (part.inlineData?.data) return [{ type: 'image', data: part.inlineData.data, mimeType: part.inlineData.mimeType }];
    return [];
  });
  const started = Date.now();
  const message = await chatKit(process.env).completeSimple(
    { provider: option.provider, id: option.modelId },
    { messages: [{ role: 'user', content, timestamp: Date.now() }] },
    { maxRetries: 0, signal },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const cost = message.chatKit.usage?.costUsd;
  const outcome = message.stopReason === 'error' ? `failed ${message.chatKit.error.code}` : message.stopReason;
  console.log(`[analyze-og] ${option.key} ${outcome} ${seconds}s cost=${cost === undefined ? 'n/a' : `US$${cost}`}`);

  if (message.stopReason === 'aborted') return undefined;
  const details = { appModelId: option.key, provider: option.provider, model: option.modelId };
  if (message.stopReason === 'error') {
    const { code, status } = message.chatKit.error;
    const reported = readable(message.errorMessage ?? `分析模型回報失敗 (${code})`);
    const text = reported.includes('User location is not supported')
      ? '地區連線限制 (User location is not supported)。請確認伺服器環境部署位置或稍後重試。'
      : reported;
    throw new AnalysisFailure(STATUS_OF_CODE[code] ?? 502, {
      error: text,
      details: { ...details, code, ...(status === undefined ? {} : { status }) },
    });
  }
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  if (!text.trim()) {
    throw new AnalysisFailure(502, {
      error: `${option.label} 沒有回覆文字（${message.stopReason}）。`,
      details: { ...details, code: 'EMPTY_RESPONSE' },
    });
  }
  return text;
}
```

## Step 2.2: Move /api/analyze-og to the chat kit and add /api/analysis-models

File: `server.ts`

Why: The Analysis step no longer calls the Gemini SDK. It runs on the model the user picked, through the chat kit, with one attempt.

**Find** (edit 1 of 3): this text occurs exactly once in `server.ts`:

```ts
import { GoogleGenAI } from "@google/genai";
```

**Replace with**: nothing. Delete the matched line(s) completely, including their line break, so that no empty line is left in their place.

**Find** (edit 2 of 3): this text occurs exactly once in `server.ts`:

```ts
import { editImages, generateImages, imageClient } from "./server/imageModels";
```

**Replace with**:

```ts
import { editImages, generateImages, imageClient } from "./server/imageModels";
import {
  AnalysisFailure,
  DEFAULT_ANALYSIS_MODEL,
  findAnalysisModel,
  listAnalysisModels,
  missingSecret,
  runAnalysis,
} from "./server/analysisModels";
```

**Find** (edit 3 of 3): this text occurs exactly once in `server.ts`:

```ts
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
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";
    try {
      res.json({ models: imageClient.forScope(scope).listModels() });
    } catch (error) {
      res.status(400).json(imageErrorBody(error));
    }
  });

  // 1. Analyze OG Prompt Endpoint
  app.post("/api/analyze-og", async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
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
        parts.push(await resolveImagePart(activeTemplate));
      }

      for (let i = 0; i < sourceImages.length; i++) {
        const img = sourceImages[i];
        if (img) {
          parts.push({ text: `【素材圖片第 ${i + 1} 張 (Source Image - 人物/主體內容)】:` });
          parts.push(await resolveImagePart(img));
        }
      }

      if (brandLogo) {
        parts.push({ text: "【用戶提供的新 Logo (優先使用於樣板指定位置)】:" });
        parts.push(await resolveImagePart(brandLogo));
      }

      // One attempt with the requested model: no retry, no fallback model.
      const analyzerResult = await ai.models.generateContent({
        model: reasoningModel || "gemini-3.8-flash",
        contents: [{ parts }],
      });

      let refinedPrompt = analyzerResult.text || "";
      let titleKeyword = "";

      // Extract TITLE_KEYWORD if generated
      const kwMatch = refinedPrompt.match(/TITLE_KEYWORD:\s*([^\r\n]+)/i);
      if (kwMatch) {
        titleKeyword = kwMatch[1].trim().replace(/^["'「『【]+|["'」』】]+$/g, "");
        refinedPrompt = refinedPrompt.replace(/TITLE_KEYWORD:\s*[^\r\n]+[\r\n]*/i, "").trim();
      }
      const rpMatch = refinedPrompt.match(/REFINED_PROMPT:\s*([\s\S]+)/i);
      if (rpMatch) {
        refinedPrompt = rpMatch[1].trim();
      }

      res.json({ refinedPrompt, titleKeyword });
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
```

**Replace with**:

```ts
  // Analysis step models: the server owns the list, the browser sends a key (POST /api/analyze-og).
  app.get("/api/analysis-models", (_req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({ defaultModel: DEFAULT_ANALYSIS_MODEL, models: listAnalysisModels(process.env) });
  });

  // Image models for one route-owned scope (?scope=generate | edit)
  app.get("/api/image-models", (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";
    try {
      res.json({ models: imageClient.forScope(scope).listModels() });
    } catch (error) {
      res.status(400).json(imageErrorBody(error));
    }
  });

  // 1. Analyze OG Prompt Endpoint (Analysis step, on the model the user picked)
  app.post("/api/analyze-og", async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    // The browser closing the request (取消) stops the analysis.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      const {
        promptText,
        activeTemplate,
        sourceImages = [],
        brandLogo,
        analysisModel = DEFAULT_ANALYSIS_MODEL,
      } = req.body;
      const option = findAnalysisModel(String(analysisModel));
      if (!option) {
        return res.status(400).json({
          error: `未知的分析模型：${String(analysisModel)}`,
          details: { code: "unknown_analysis_model" },
        });
      }
      const missing = missingSecret(option, process.env);
      if (missing) {
        return res.status(503).json({
          error: `伺服器未設定 ${missing}，無法使用 ${option.providerLabel} 的 ${option.label}。請在設定中確認金鑰。`,
          details: { appModelId: option.key, provider: option.provider, model: option.modelId, code: "missing_key" },
        });
      }

      const parts: ImagePart[] = [
        { text: promptText }
      ];

      if (activeTemplate) {
        parts.push({ text: "【最高基準：樣板圖片 (Design, Typography & Aesthetic Style Template)】：\n這是排版佈局、主標題字體風格、文字色彩與整體美術調性的最高基準。請深入分析其字體外觀（字重粗細、文字顏色、是否有描邊綑邊、是否有底襯）與設計風格。" });
        parts.push(await resolveImagePart(activeTemplate));
      }

      for (let i = 0; i < sourceImages.length; i++) {
        const img = sourceImages[i];
        if (img) {
          parts.push({ text: `【素材圖片第 ${i + 1} 張 (Source Image - 人物/主體內容)】:` });
          parts.push(await resolveImagePart(img));
        }
      }

      if (brandLogo) {
        parts.push({ text: "【用戶提供的新 Logo (優先使用於樣板指定位置)】:" });
        parts.push(await resolveImagePart(brandLogo));
      }

      // One attempt with the model the user picked: no retry, no other model, no other provider.
      let analysis: string | undefined;
      try {
        analysis = await runAnalysis(option, parts, abort.signal);
      } catch (failure) {
        if (failure instanceof AnalysisFailure) return res.status(failure.status).json(failure.body);
        throw failure;
      }
      // undefined: the browser closed the request, so there is nobody to answer.
      if (analysis === undefined) return;

      let refinedPrompt = analysis;
      let titleKeyword = "";

      // Extract TITLE_KEYWORD if generated
      const kwMatch = refinedPrompt.match(/TITLE_KEYWORD:\s*([^\r\n]+)/i);
      if (kwMatch) {
        titleKeyword = kwMatch[1].trim().replace(/^["'「『【]+|["'」』】]+$/g, "");
        refinedPrompt = refinedPrompt.replace(/TITLE_KEYWORD:\s*[^\r\n]+[\r\n]*/i, "").trim();
      }
      const rpMatch = refinedPrompt.match(/REFINED_PROMPT:\s*([\s\S]+)/i);
      if (rpMatch) {
        refinedPrompt = rpMatch[1].trim();
      }

      res.json({ refinedPrompt, titleKeyword });
    } catch (error: any) {
      console.error("API /api/analyze-og error:", error);
      res.status(500).json({ error: error?.message || String(error) });
    }
  });
```

## Step 2.3: Remove @google/genai

File: `package.json`

Why: Only the old analysis route used it. The chat kit brings its own.

**Find**: this text occurs exactly once in `package.json`:

```json
    "@google/genai": "^1.29.0",
```

**Replace with**: nothing. Delete the matched line(s) completely, including their line break, so that no empty line is left in their place.

## Step 2.4: Say which secrets the Analysis step uses

File: `.env.example`

Why: Documentation only.

**Find** (edit 1 of 2): this text occurs exactly once in `.env.example`:

```
# GEMINI_API_KEY: Required for Gemini AI API calls.
```

**Replace with**:

```
# GEMINI_API_KEY: Required for the Google image models and the Google analysis model (Gemini 3.8 Flash).
```

**Find** (edit 2 of 2): this text occurs exactly once in `.env.example`:

```
# KIE_API_KEY: Required for the KIE image models (Nano Banana 2.1, GPT Image 2, Grok Imagine 2.0).
```

**Replace with**:

```
# KIE_API_KEY: Required for the KIE image models (Nano Banana 2.1, GPT Image 2, Grok Imagine 2.0) and the KIE analysis models (Gemini 3.8 / 3.6 Flash, Gemini 4 Argon, Claude Sonnet 5.5, GPT-6 Luna).
```

## After the last step

Run `npm install` so that `package-lock.json` is updated (`@google/genai` is gone), and make sure it finishes without an error.

## Checkpoint

Run `npm run lint`.

- An error that was already there before your changes is not yours (for example `'ErrorBoundary' cannot be used as a JSX component` in `src/App.tsx`). Report it, and leave it.
- Any other error comes from one of the steps above: fix your edit so it matches the step exactly, and run `npm run lint` again.

Then report: each step number with *done* or *stopped*, and the result of `npm run lint`.
