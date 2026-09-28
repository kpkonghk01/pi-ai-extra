import { randomUUID } from "node:crypto";
import {
  generateKieImage,
  isPiAiExtraError,
  KIE_IMAGE_MODELS,
  type ImageGenerationResult,
  type ImageModelInfo,
  type KieImageRequest,
} from "@hk01/pi-ai-extra-kie";
import { generateToapisImage, TOAPIS_IMAGE_MODELS, type ToapisImageRequest } from "@hk01/pi-ai-extra-toapis";
import { generateGoogleImage, GOOGLE_IMAGE_MODELS, type GoogleImageRequest } from "@hk01/pi-ai-extra-google";

/**
 * The only place this app talks to image providers. Every request goes to exactly
 * one provider/model chosen by the user: no model fallback, no provider fallback,
 * no cross-provider uploads, and reference images are never dropped.
 */

type Provider = "kie" | "toapis" | "google";

export interface AppImageRequest {
  /** Model id from src/models.config.ts, e.g. "kie-gpt-image-2". */
  appModelId: string;
  prompt: string;
  /** Data URLs or http(s) URLs, in the order the prompt describes them. */
  referenceImages: string[];
  /** App ratio preset, e.g. "16:9", "4:5", "300x250". */
  ratio: string;
  quality: "1K" | "2K";
  signal?: AbortSignal;
}

/** What the UI shows (and users copy into bug reports) for a failed request. */
export interface AppErrorDetails {
  provider?: string;
  model?: string;
  code?: string;
  taskId?: string;
  status?: number;
  providerCode?: string;
}

export class AppImageError extends Error {
  readonly details: AppErrorDetails;
  constructor(message: string, details: AppErrorDetails = {}, cause?: unknown) {
    super(message, { cause });
    this.name = "AppImageError";
    this.details = details;
  }
  get code(): string | undefined {
    return this.details.code;
  }
}

/** Error details for the API response. Unknown errors still report their message; nothing is hidden. */
export function errorDetails(error: unknown): AppErrorDetails {
  if (error instanceof AppImageError) return error.details;
  if (isPiAiExtraError(error)) return { provider: error.provider, model: error.model, code: error.code, taskId: error.taskId, status: error.status };
  return { code: "unexpected" };
}

const SECRET_NAMES: Record<Provider, string> = { kie: "KIE_API_KEY", toapis: "TOAPIS_API_KEY", google: "GEMINI_API_KEY" };
const CATALOGUES: Record<Provider, readonly ImageModelInfo[]> = { kie: KIE_IMAGE_MODELS, toapis: TOAPIS_IMAGE_MODELS, google: GOOGLE_IMAGE_MODELS };
const TOAPIS_MODELS = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2", "doubao-seedream-5-0-pro", "gemini-3.1-flash-image-preview"]);

/** App model id → provider model operation. Text-to-image vs edit is chosen explicitly from the reference count. */
function resolveTarget(appModelId: string, referenceCount: number): { provider: Provider; model: string } {
  const hasReferences = referenceCount > 0;
  if (appModelId === "kie-gpt-image-2") return { provider: "kie", model: hasReferences ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image" };
  if (appModelId === "kie-grok-imagine-2") {
    return { provider: "kie", model: hasReferences ? "grok-imagine-image-2-0/image-edit" : "grok-imagine-image-2-0/text-to-image" };
  }
  if (appModelId === "kie-nano-banana-2") return { provider: "kie", model: "nano-banana-2" };
  if (TOAPIS_MODELS.has(appModelId)) return { provider: "toapis", model: appModelId };
  if (appModelId === "nano-banana-2") return { provider: "google", model: "gemini-3.1-flash-image" };
  if (appModelId === "nano-banana-pro") return { provider: "google", model: "gemini-3-pro-image" };
  throw new AppImageError(`模型 ${appModelId} 目前不支援（請在模型選單選擇其他模型）。`, { code: "unsupported_model", model: appModelId });
}

const PRESET_RATIOS: Record<string, number> = {
  "300x250": 300 / 250,
  "336x280": 336 / 280,
  "6:5": 6 / 5,
  "300x300": 1,
  "300x600": 300 / 600,
  "320x480": 320 / 480,
  "1.91:1": 1.91,
};

/** KIE GPT Image 2 documents ratios that are unavailable at 2K/4K. */
const KIE_GPT_UNSUPPORTED_AT: Record<string, readonly string[]> = {
  "2K": ["5:4", "4:5", "3:1", "1:3", "9:21"],
  "4K": ["1:1", "3:1", "1:3", "9:21"],
};

function ratioValue(ratio: string): number | undefined {
  if (PRESET_RATIOS[ratio] !== undefined) return PRESET_RATIOS[ratio];
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  return match ? Number(match[1]) / Number(match[2]) : undefined;
}

/** Picks the model's own value for the app preset: exact match, else the nearest supported ratio. */
function pickAspectRatio(info: ImageModelInfo, ratio: string, resolution: string | undefined): string | undefined {
  if (!info.aspectRatio) return undefined;
  const blocked = info.id.startsWith("gpt-image-2-") && resolution ? (KIE_GPT_UNSUPPORTED_AT[resolution] ?? []) : [];
  const candidates = info.aspectRatio.values.filter((value) => value !== "auto" && !blocked.includes(value));
  if (candidates.includes(ratio)) return ratio;
  const target = ratioValue(ratio) ?? 16 / 9;
  const distance = (value: string): number => Math.abs(Math.log((ratioValue(value) ?? 1) / target));
  return [...candidates].sort((a, b) => distance(a) - distance(b))[0];
}

function apiKeyFor(provider: Provider): string {
  const name = SECRET_NAMES[provider];
  const value = process.env[name]?.trim();
  if (!value) throw new AppImageError(`${name} 未設定或為空，請在 Settings 秘密設定 (Secrets) 中配置 ${name}。`, { code: "missing_key", provider });
  return value;
}

/** Turns a package error into a user-facing message that keeps provider/model and the error code. */
function toAppError(error: unknown): Error {
  if (!isPiAiExtraError(error)) return error instanceof Error ? error : new Error(String(error));
  const where = `${error.provider}/${error.model}`;
  const prefix =
    error.code === "content_blocked"
      ? `內容未通過 ${where} 安全審查（Safety Filter）`
      : error.code === "reference_limit"
        ? `參考圖片數量超出 ${where} 的上限（圖片不會被自動刪減，請減少素材或 Logo）`
        : error.code === "auth"
          ? `${where} 金鑰無效或未授權，請檢查 Secrets`
          : error.code === "insufficient_credits"
            ? `${where} 帳戶額度不足`
            : `${where} 生成失敗 [${error.code}]`;
  const detail = error.message.replace(/^\[[^\]]+\]\s*/, "");
  const details: AppErrorDetails = {
    provider: error.provider,
    model: error.model,
    code: error.code,
    ...(error.taskId ? { taskId: error.taskId } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.providerCode ? { providerCode: error.providerCode } : {}),
  };
  return new AppImageError(`${prefix}：${detail}`, details, error);
}

function logUsage(result: ImageGenerationResult, clientBusinessId: string | undefined): void {
  console.log(
    `[usage] ${result.provider}/${result.model} task=${result.taskId ?? "-"} ref=${clientBusinessId ?? "-"} elapsedMs=${result.elapsedMs} usage=${JSON.stringify(result.usage ?? null)}`,
  );
}

/** Generates or edits one image and returns it as a data URL. */
export async function generateAppImage(request: AppImageRequest): Promise<string> {
  const target = resolveTarget(request.appModelId, request.referenceImages.length);
  const info = CATALOGUES[target.provider].find((model) => model.id === target.model);
  if (!info) throw new AppImageError(`找不到模型設定 ${target.provider}/${target.model}`, { code: "unsupported_model", ...target });
  const resolution = info.resolution?.values.includes(request.quality) ? request.quality : undefined;
  const common = {
    apiKey: apiKeyFor(target.provider),
    prompt: request.prompt,
    referenceImages: request.referenceImages,
    aspectRatio: pickAspectRatio(info, request.ratio, resolution),
    signal: request.signal,
  };
  const clientBusinessId = target.provider === "toapis" ? `open-graph-single:${randomUUID()}` : undefined;
  try {
    const result =
      target.provider === "kie"
        ? await generateKieImage({ ...common, model: target.model, resolution, outputFormat: target.model === "nano-banana-2" ? "jpg" : undefined } as KieImageRequest)
        : target.provider === "toapis"
          ? await generateToapisImage({
              ...common,
              model: target.model,
              resolution,
              clientBusinessId,
              watermark: target.model === "doubao-seedream-5-0-pro" ? false : undefined,
            } as ToapisImageRequest)
          : await generateGoogleImage({
              ...common,
              model: target.model,
              resolution,
              headers: { "User-Agent": "aistudio-build" },
              safetySettings: [
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
              ],
            } as GoogleImageRequest);
    logUsage(result, clientBusinessId);
    const image = result.images[0];
    if (!image) {
      throw new AppImageError(`${result.provider}/${result.model} 沒有返回圖片`, {
        code: "no_output",
        provider: result.provider,
        model: result.model,
        ...(result.taskId ? { taskId: result.taskId } : {}),
      });
    }
    return image.dataUrl;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Gemini-style interleaved parts (text labels + inline images) → one prompt with numbered image markers. */
export function partsToPrompt(parts: ReadonlyArray<{ text?: string; inlineData?: { data: string; mimeType: string } }>): {
  prompt: string;
  referenceImages: string[];
} {
  const referenceImages: string[] = [];
  const lines: string[] = [];
  for (const part of parts) {
    if (part.inlineData) {
      referenceImages.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
      lines.push(`[Reference image ${referenceImages.length}]`);
    } else if (part.text) {
      lines.push(part.text);
    }
  }
  return { prompt: lines.join("\n\n"), referenceImages };
}
