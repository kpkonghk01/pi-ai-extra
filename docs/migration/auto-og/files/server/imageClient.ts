import { randomUUID } from 'node:crypto';
import { generateKieImage, isPiAiExtraError, type ImageGenerationResult, type KieImageRequest, type PiAiExtraError } from '@hk01/pi-ai-extra-kie';
import { generateToapisImage, type ToapisImageRequest } from '@hk01/pi-ai-extra-toapis';
// The Google 0.2.0 type includes the optional temperature / systemInstruction catalogue fields.
import { generateGoogleImage, type GoogleImageRequest, type ImageModelInfo } from '@hk01/pi-ai-extra-google';
import { TEMPERATURE_SUPPORT_NOTE, type ImageErrorDetails, type ImageProvider } from '../shared/imageModels';
import { outputSpec, ratioValue } from '../shared/imageOutput';
import { findRegistryEntry, providerKey, resolveOperation, secretName } from './imageModels';

/**
 * The only place this app talks to image providers. Each request goes to exactly the
 * provider/model the user selected: no model or provider fallback, no cross-provider
 * uploads, reference images are never dropped, and a billed submission is never re-sent.
 */

export interface ImagePart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}

export interface AppImageRequest {
  appModelId: string;
  /** Gemini-style parts in order: text labels and inline images. */
  parts: readonly ImagePart[];
  /** Model rules. Sent as systemInstruction where supported, otherwise placed before the prompt. */
  systemInstruction: string;
  /**
   * App ratio preset ("16:9", "300x250", …) or the input image's "width:height". Decides the
   * resolution, and the aspect ratio unless the input aspect is kept. Required when an aspect
   * ratio has to be chosen.
   */
  ratio: string | undefined;
  /** Edits: keep the input image's aspect where the model can (Google: omit; KIE: "auto"). */
  keepInputAspect?: boolean;
  /** Raw request value; validated here (number, and accepted by the model). */
  temperature?: unknown;
}

/** What the UI shows, and users copy into bug reports, for a failed request. */
export type AppErrorDetails = ImageErrorDetails;

export class AppImageError extends Error {
  readonly details: AppErrorDetails;
  /** HTTP status when the error is found before any provider call. */
  readonly httpStatus: number;
  constructor(message: string, details: AppErrorDetails = {}, options: { httpStatus?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppImageError';
    this.details = details;
    this.httpStatus = options.httpStatus ?? 500;
  }
}

function packageErrorDetails(error: PiAiExtraError, appModelId?: string): AppErrorDetails {
  return {
    ...(appModelId ? { appModelId } : {}),
    provider: error.provider,
    model: error.model,
    code: error.code,
    ...(error.taskId ? { taskId: error.taskId } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.providerCode ? { providerCode: error.providerCode } : {}),
  };
}

/** Details for an API error response. Unknown errors still report their message; nothing is hidden. */
export function errorDetails(error: unknown): AppErrorDetails {
  if (error instanceof AppImageError) return error.details;
  if (isPiAiExtraError(error)) return packageErrorDetails(error);
  return { code: 'unexpected' };
}

export interface PreparedImageRequest {
  appModelId: string;
  provider: ImageProvider;
  info: ImageModelInfo;
  apiKey: string;
  prompt: string;
  systemInstruction: string | undefined;
  referenceImages: string[];
  aspectRatio: string | undefined;
  resolution: string | undefined;
  temperature: number | undefined;
}

/**
 * KIE GPT Image 2 ratios that are unavailable at 2K. The catalogue states this only as a note
 * (the package rejects them), so it is repeated here to pick a ratio the package accepts.
 */
const KIE_GPT_UNSUPPORTED_AT: Record<string, readonly string[]> = {
  '2K': ['5:4', '4:5', '3:1', '1:3', '9:21'],
};

/** The model's own ratio for an app preset: an exact match, otherwise the nearest supported ratio. */
function pickAspectRatio(info: ImageModelInfo, ratio: string, target: number, resolution: string | undefined): string | undefined {
  if (!info.aspectRatio) return undefined;
  const blocked = info.id.startsWith('gpt-image-2-') && resolution ? (KIE_GPT_UNSUPPORTED_AT[resolution] ?? []) : [];
  const candidates = info.aspectRatio.values.filter((value) => value !== 'auto' && !blocked.includes(value));
  if (candidates.includes(ratio)) return ratio;
  const distance = (value: string): number => Math.abs(Math.log((ratioValue(value) ?? Number.POSITIVE_INFINITY) / target));
  return [...candidates].sort((a, b) => distance(a) - distance(b))[0];
}

/**
 * The aspect value that keeps the input image's aspect: "auto" where offered, omitted where the
 * model matches the input by default (Gemini), or null when the model cannot keep it.
 */
function inputAspectValue(info: ImageModelInfo): string | undefined | null {
  if (!info.aspectRatio) return undefined;
  if (info.aspectRatio.values.includes('auto')) return 'auto';
  return info.aspectRatio.default === null && !info.aspectRatio.required ? undefined : null;
}

/** Gemini-style interleaved parts → one prompt with numbered image markers, images kept in order. */
export function partsToPrompt(parts: readonly ImagePart[]): { prompt: string; referenceImages: string[] } {
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
  return { prompt: lines.join('\n\n'), referenceImages };
}

function aspectRatioFor(info: ImageModelInfo, request: AppImageRequest, resolution: string | undefined, base: AppErrorDetails): string | undefined {
  const kept = request.keepInputAspect ? inputAspectValue(info) : null;
  if (kept !== null) return kept;
  const target = request.ratio === undefined ? undefined : ratioValue(request.ratio);
  if (target === undefined || !Number.isFinite(target) || target <= 0) {
    throw new AppImageError(`無法判斷圖片比例（收到「${request.ratio ?? ''}」），無法為 ${info.id} 選擇比例。`, { ...base, code: 'invalid_request' }, { httpStatus: 400 });
  }
  return pickAspectRatio(info, request.ratio ?? '', target, resolution);
}

function validTemperature(value: unknown, base: AppErrorDetails): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppImageError('temperature 必須是數字。', { ...base, code: 'invalid_request' }, { httpStatus: 400 });
  }
  return value;
}

/** Validates everything that can fail before a provider is called (HTTP 400 / 503). */
export function prepareAppImage(request: AppImageRequest): PreparedImageRequest {
  const entry = findRegistryEntry(request.appModelId);
  if (!entry) {
    throw new AppImageError(`不支援的圖片模型「${request.appModelId}」，請在模型選單重新選擇。`, { code: 'unsupported_model', appModelId: request.appModelId }, { httpStatus: 400 });
  }
  const base = { appModelId: entry.id, provider: entry.provider };
  const { prompt, referenceImages } = partsToPrompt(request.parts);
  const info = resolveOperation(entry, referenceImages.length);
  if (!info) throw new AppImageError(`已安裝的 ${entry.provider} 套件不包含 ${entry.model}。`, { ...base, code: 'unsupported_model' });
  const target = { ...base, model: info.id };

  const apiKey = providerKey(entry.provider);
  if (!apiKey) {
    throw new AppImageError(`伺服器未設定 ${secretName(entry.provider)}，無法使用 ${entry.label}。`, { ...target, code: 'missing_key' }, { httpStatus: 503 });
  }
  const temperature = validTemperature(request.temperature, target);
  if (temperature !== undefined && !info.temperature) {
    throw new AppImageError(`${entry.label} 不支援 Temperature。${TEMPERATURE_SUPPORT_NOTE}`, { ...target, code: 'temperature_unsupported' }, { httpStatus: 400 });
  }
  const { min, max } = info.referenceImages;
  if (referenceImages.length < min || (max !== null && referenceImages.length > max)) {
    const limit = max === null ? `至少 ${min} 張` : `${min}–${max} 張`;
    throw new AppImageError(`${entry.label} 接受 ${limit}參考圖，這次有 ${referenceImages.length} 張（圖片不會被自動刪減）。`, { ...target, code: 'reference_limit' }, { httpStatus: 400 });
  }

  const wanted = outputSpec(request.ratio ?? '').resolution;
  const resolution = info.resolution?.values.includes(wanted) ? wanted : undefined;
  const separateRules = info.systemInstruction === true;
  return {
    ...target,
    info,
    apiKey,
    prompt: separateRules ? prompt : `${request.systemInstruction.trim()}\n\n${prompt}`,
    systemInstruction: separateRules ? request.systemInstruction : undefined,
    referenceImages,
    aspectRatio: aspectRatioFor(info, request, resolution, target),
    resolution,
    temperature,
  };
}

/** Turns a package error into a user-facing message that keeps provider/model and the error code. */
function toAppError(error: unknown, appModelId: string): Error {
  if (error instanceof AppImageError || !isPiAiExtraError(error)) return error instanceof Error ? error : new Error(String(error));
  const where = `${error.provider}/${error.model}`;
  const prefix =
    error.code === 'content_blocked'
      ? `內容未通過 ${where} 安全審查`
      : error.code === 'reference_limit'
        ? `參考圖片數量超出 ${where} 的上限（圖片不會被自動刪減）`
        : error.code === 'auth'
          ? `${where} 金鑰無效或未授權，請檢查 Secrets`
          : error.code === 'insufficient_credits'
            ? `${where} 帳戶額度不足`
            : `${where} 生成失敗 [${error.code}]`;
  const detail = error.message.replace(/^\[[^\]]+\]\s*/, '');
  return new AppImageError(`${prefix}：${detail}`, packageErrorDetails(error, appModelId), { cause: error });
}

/** Provider-reported usage, logged per task id for later per-app recording. */
function logUsage(result: ImageGenerationResult, appModelId: string, clientBusinessId: string | undefined): void {
  console.info(
    `[usage] app=auto-og model=${appModelId} ${result.provider}/${result.model} task=${result.taskId ?? '-'} ref=${clientBusinessId ?? '-'} elapsedMs=${result.elapsedMs} usage=${JSON.stringify(result.usage ?? null)}`,
  );
}

async function callProvider(prepared: PreparedImageRequest, signal: AbortSignal | undefined, clientBusinessId: string | undefined): Promise<ImageGenerationResult> {
  const common = {
    apiKey: prepared.apiKey,
    model: prepared.info.id,
    prompt: prepared.prompt,
    referenceImages: prepared.referenceImages,
    aspectRatio: prepared.aspectRatio,
    resolution: prepared.resolution,
    signal,
  };
  if (prepared.provider === 'google') {
    return generateGoogleImage({ ...common, temperature: prepared.temperature, systemInstruction: prepared.systemInstruction } as GoogleImageRequest);
  }
  if (prepared.provider === 'kie') return generateKieImage(common as KieImageRequest);
  return generateToapisImage({
    ...common,
    clientBusinessId,
    watermark: prepared.info.watermark ? false : undefined,
  } as ToapisImageRequest);
}

/** Generates or edits one image with the prepared provider/model and returns it as a data URL. */
export async function runAppImage(prepared: PreparedImageRequest, signal?: AbortSignal): Promise<string> {
  const clientBusinessId = prepared.provider === 'toapis' ? `auto-og:${randomUUID()}` : undefined;
  try {
    const result = await callProvider(prepared, signal, clientBusinessId);
    logUsage(result, prepared.appModelId, clientBusinessId);
    const image = result.images[0];
    if (!image) {
      throw new AppImageError(`${result.provider}/${result.model} 沒有返回圖片。`, {
        appModelId: prepared.appModelId,
        provider: result.provider,
        model: result.model,
        code: 'no_output',
        ...(result.taskId ? { taskId: result.taskId } : {}),
      });
    }
    return image.dataUrl;
  } catch (error) {
    throw toAppError(error, prepared.appModelId);
  }
}
