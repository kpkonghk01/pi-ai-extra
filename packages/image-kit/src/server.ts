import { randomUUID } from 'node:crypto';
import { GOOGLE_IMAGE_MODELS, generateGoogleImage, type GoogleImageRequest, type ImageModelInfo } from '@hk01/pi-ai-extra-google';
import { KIE_IMAGE_MODELS, generateKieImage, isPiAiExtraError, type ImageGenerationResult, type KieImageRequest, type PiAiExtraError } from '@hk01/pi-ai-extra-kie';
import { TOAPIS_IMAGE_MODELS, generateToapisImage, type ToapisImageRequest } from '@hk01/pi-ai-extra-toapis';
import {
  STRICT_RESOLUTIONS,
  TEMPERATURE_SUPPORT_NOTE,
  ratioValue,
  type ImageErrorDetails,
  type ImageModelView,
  type ImageProvider,
  type MaskEditing,
  type OutputResolution,
  type PriceEstimate,
} from './models.ts';

/**
 * Server side: the only place an app talks to image providers. Each request goes to exactly
 * the provider/model the user selected: no model or provider fallback, reference images are
 * never dropped, and a billed submission is never re-sent.
 *
 * Server-only: never import `@hk01/pi-ai-extra-image-kit/server` from browser code. App-specific
 * choices (model list, prices, secret names) go in the config passed to createImageClient().
 */

/** One image model the app offers, mapped to a provider model operation from the package catalogues. */
export interface ImageModelOption {
  /** App model id, stored by the UI (for example "nano-banana-2"). */
  id: string;
  label: string;
  description: string;
  provider: ImageProvider;
  /** Catalogue operation used with reference images (and without them, unless textOnlyModel is set). */
  model: string;
  /** Catalogue text-to-image operation used when a request has no reference images. */
  textOnlyModel?: string;
  maskEditing: MaskEditing;
  /** Verified list prices only; null shows "—". */
  price: PriceEstimate | null;
}

/** Re-encodes a reference image the model cannot take as is (for example WebP for Seedream, or too large). */
export type ReferenceConverter = (
  dataUrl: string,
  target: { acceptedMimeTypes: readonly string[]; maxInlineBytes: number },
) => Promise<string>;

export interface ImageClientConfig {
  /** App name for usage logs and ToAPIs client_business_id (`<app>:<uuid>`). */
  app: string;
  /** Selector order within each provider group. */
  models: readonly ImageModelOption[];
  /** Secret names to read per provider, first non-empty wins. Defaults below. */
  secretNames?: Partial<Record<ImageProvider, readonly string[]>>;
  providerLabels?: Partial<Record<ImageProvider, string>>;
  /** Without one, a reference the model cannot take is rejected with HTTP 400. */
  convertReference?: ReferenceConverter;
  /** Extra non-credential headers for Google (AI Studio apps send `User-Agent: aistudio-build`). */
  googleHeaders?: Record<string, string>;
  /**
   * Server-side secrets, read at call time (pass `process.env`). The kit never reads the
   * environment by itself, like the provider packages (ADR 0003).
   */
  env: Record<string, string | undefined>;
  /** Custom fetch passed to the packages (tests, proxies). Default global fetch. */
  fetch?: typeof globalThis.fetch;
}

/** A Gemini-style part: a text label or an inline image, in prompt order. */
export interface ImagePart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}

export interface ImageRequest {
  appModelId: string;
  parts: readonly ImagePart[];
  /** Model rules. Sent as systemInstruction where supported, otherwise placed before the prompt. */
  systemInstruction?: string;
  /**
   * Target aspect as "W:H" or "WxH" ("4:5", "300x250"). Required unless keepInputAspect is set
   * and the model can keep the input aspect by itself; for edits pass the input image's own W:H.
   */
  aspectRatio?: string;
  /**
   * Keep the input image's aspect where the model can (Google: omit; KIE: "auto"), when it is the
   * only image. Otherwise the nearest ratio to `aspectRatio` is sent; crop the result to be exact.
   */
  keepInputAspect?: boolean;
  /** 4K is only sent to models that list it; 1K / 2K are omitted for models without the option. */
  resolution?: OutputResolution;
  /** Raw request value; validated here (number, accepted by the model, within its range). */
  temperature?: unknown;
}

export interface PreparedImageRequest {
  appModelId: string;
  label: string;
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

export interface ImageResult {
  dataUrl: string;
  provider: string;
  model: string;
  taskId: string | undefined;
}

export interface ImageClient {
  /** Body of GET /api/image-models: `{ models: listModels() }`. */
  listModels(): ImageModelView[];
  findModel(appModelId: string): ImageModelView | undefined;
  /** Validates everything that can fail before a provider is called (AppImageError with HTTP 400 / 503). */
  prepare(request: ImageRequest): Promise<PreparedImageRequest>;
  /** Generates or edits one image with the prepared provider/model. */
  run(prepared: PreparedImageRequest, signal?: AbortSignal): Promise<ImageResult>;
}

export class AppImageError extends Error {
  readonly details: ImageErrorDetails;
  /** HTTP status when the error is found before any provider call. */
  readonly httpStatus: number;
  constructor(message: string, details: ImageErrorDetails = {}, options: { httpStatus?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppImageError';
    this.details = details;
    this.httpStatus = options.httpStatus ?? 500;
  }
}

const DEFAULT_SECRET_NAMES: Record<ImageProvider, readonly string[]> = {
  google: ['GEMINI_API_KEY', 'API_KEY'],
  kie: ['KIE_API_KEY'],
  toapis: ['TOAPIS_API_KEY'],
};

const DEFAULT_PROVIDER_LABELS: Record<ImageProvider, string> = {
  google: 'Google Gemini',
  kie: 'KIE 提供',
  toapis: 'ToAPIs 提供',
};

const CATALOGUES: Record<ImageProvider, readonly ImageModelInfo[]> = {
  google: GOOGLE_IMAGE_MODELS,
  kie: KIE_IMAGE_MODELS,
  toapis: TOAPIS_IMAGE_MODELS,
};

const OUTPUT_RESOLUTIONS: readonly OutputResolution[] = ['1K', '2K', '4K'];

/**
 * KIE GPT Image 2 values that are unavailable at a resolution. The catalogue states these only
 * as notes (the package rejects them), so they are repeated here to pick values it accepts.
 */
const KIE_GPT_IMAGE_2_BLOCKED: Record<string, readonly string[]> = {
  '2K': ['5:4', '4:5', '3:1', '1:3', '9:21', 'auto'],
  '4K': ['1:1', '3:1', '1:3', '9:21', 'auto'],
};

function blockedAspects(info: ImageModelInfo, resolution: string | undefined): readonly string[] {
  if (info.provider !== 'kie' || !info.id.startsWith('gpt-image-2-') || resolution === undefined) return [];
  return KIE_GPT_IMAGE_2_BLOCKED[resolution] ?? [];
}

/** The model's own ratio for a target aspect: an exact match, otherwise the nearest it accepts. */
export function pickAspectRatio(info: ImageModelInfo, target: number, resolution: string | undefined): string | undefined {
  if (!info.aspectRatio) return undefined;
  const blocked = blockedAspects(info, resolution);
  const candidates = info.aspectRatio.values.filter((value) => value !== 'auto' && !blocked.includes(value));
  const distance = (value: string): number => Math.abs(Math.log((ratioValue(value) ?? Number.POSITIVE_INFINITY) / target));
  // Equally near ratios (1:1 → 5:4 or 4:5) differ only by rounding; the catalogue order decides.
  return [...candidates].sort((a, b) => {
    const difference = distance(a) - distance(b);
    return Math.abs(difference) < 1e-9 ? 0 : difference;
  })[0];
}

/**
 * The aspect value that keeps the input image's aspect: "auto" where offered, omitted for Google
 * (Gemini follows the input), or null when an explicit ratio is needed. With more than one image
 * the model could follow any of them, so an explicit ratio is always used then.
 */
function inputAspectValue(info: ImageModelInfo, resolution: string | undefined, imageCount: number): string | undefined | null {
  if (!info.aspectRatio) return undefined;
  if (imageCount !== 1) return null;
  if (info.aspectRatio.values.includes('auto')) return blockedAspects(info, resolution).includes('auto') ? null : 'auto';
  return info.provider === 'google' && info.aspectRatio.default === null && !info.aspectRatio.required ? undefined : null;
}

/** Gemini-style parts → one prompt with numbered image markers, images kept in order. */
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

/** Image format from the first bytes, like the packages do (a declared type is not trusted). */
function sniffMimeType(base64: string): string | undefined {
  const bytes = Buffer.from(base64.slice(0, 24), 'base64');
  const startsWith = (...values: number[]): boolean => values.every((value, index) => bytes[index] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

/** Actual MIME type and decoded size of a base64 data URL, or null when it is not one. */
function inspectDataUrl(dataUrl: string): { mimeType: string; bytes: number } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const data = (match[2] ?? '').replace(/\s/g, '');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const declared = (match[1] ?? '').toLowerCase();
  return { mimeType: sniffMimeType(data) ?? declared, bytes: Math.floor((data.length * 3) / 4) - padding };
}

function referenceProblem(dataUrl: string, info: ImageModelInfo): string | null {
  const facts = inspectDataUrl(dataUrl);
  if (!facts) return '不是 base64 data URL';
  const { acceptedMimeTypes, maxInlineBytes } = info.referenceImages;
  if (!(acceptedMimeTypes as readonly string[]).includes(facts.mimeType)) return `格式 ${facts.mimeType} 不被接受（接受 ${acceptedMimeTypes.join('、')}）`;
  if (facts.bytes > maxInlineBytes) return `大小 ${(facts.bytes / 1_048_576).toFixed(1)} MB 超過上限 ${(maxInlineBytes / 1_048_576).toFixed(0)} MB`;
  return null;
}

function packageErrorDetails(error: PiAiExtraError, appModelId?: string): ImageErrorDetails {
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

/** Turns a package error into a user-facing message that keeps provider/model and the error code. */
function toAppError(error: unknown, appModelId: string): Error {
  if (error instanceof AppImageError || !isPiAiExtraError(error)) return error instanceof Error ? error : new Error(String(error));
  const where = `${error.provider}/${error.model}`;
  const prefixes: Partial<Record<string, string>> = {
    content_blocked: `內容未通過 ${where} 安全審查`,
    reference_limit: `參考圖片數量超出 ${where} 的上限（圖片不會被自動刪減）`,
    auth: `${where} 金鑰無效或未授權，請檢查 Secrets`,
    insufficient_credits: `${where} 帳戶額度不足`,
    aborted: `${where} 請求已取消`,
  };
  const prefix = prefixes[error.code] ?? `${where} 生成失敗 [${error.code}]`;
  const detail = error.message.replace(/^\[[^\]]+\]\s*/, '');
  return new AppImageError(`${prefix}：${detail}`, packageErrorDetails(error, appModelId), { cause: error });
}

/** Details for an error response. Unknown errors still report their message; nothing is hidden. */
export function imageErrorDetails(error: unknown): ImageErrorDetails {
  if (error instanceof AppImageError) return error.details;
  if (isPiAiExtraError(error)) return packageErrorDetails(error);
  return { code: 'unexpected' };
}

/** `{ error, details }` body for a JSON error response or an NDJSON `error` line. */
export function imageErrorBody(error: unknown): { error: string; details: ImageErrorDetails } {
  return { error: error instanceof Error ? error.message : String(error), details: imageErrorDetails(error) };
}

/** HTTP status for an error found before streaming started (400 / 503 from prepare, else 500). */
export function imageErrorStatus(error: unknown): number {
  return error instanceof AppImageError ? error.httpStatus : 500;
}

export function createImageClient(config: ImageClientConfig): ImageClient {
  const ids = new Set<string>();
  for (const option of config.models) {
    if (ids.has(option.id)) throw new Error(`image-kit: duplicate model id "${option.id}"`);
    ids.add(option.id);
  }
  const secretNames = (provider: ImageProvider): readonly string[] => config.secretNames?.[provider] ?? DEFAULT_SECRET_NAMES[provider];

  function providerKey(provider: ImageProvider): string | undefined {
    for (const name of secretNames(provider)) {
      const value = config.env[name]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  function catalogueInfo(provider: ImageProvider, model: string): ImageModelInfo | undefined {
    return CATALOGUES[provider].find((info) => info.id === model);
  }

  function operationInfos(option: ImageModelOption): ImageModelInfo[] {
    const models = option.textOnlyModel ? [option.textOnlyModel, option.model] : [option.model];
    return models.flatMap((model) => {
      const info = catalogueInfo(option.provider, model);
      return info ? [info] : [];
    });
  }

  function toView(option: ImageModelOption): ImageModelView {
    const infos = operationInfos(option);
    const main = catalogueInfo(option.provider, option.model);
    const missing = !main || infos.length < (option.textOnlyModel ? 2 : 1);
    const hasKey = providerKey(option.provider) !== undefined;
    const maxes = infos.map((info) => info.referenceImages.max);
    return {
      id: option.id,
      label: option.label,
      description: option.description,
      provider: option.provider,
      providerLabel: config.providerLabels?.[option.provider] ?? DEFAULT_PROVIDER_LABELS[option.provider],
      providerModel: option.model,
      acceptedMimeTypes: main ? [...main.referenceImages.acceptedMimeTypes] : [],
      referenceLimit: {
        min: infos.length > 0 ? Math.min(...infos.map((info) => info.referenceImages.min)) : 0,
        max: maxes.includes(null) ? null : Math.max(0, ...maxes.map((max) => max ?? 0)),
      },
      temperature: main?.temperature ? { min: main.temperature.min, max: main.temperature.max } : null,
      resolutions: OUTPUT_RESOLUTIONS.filter((value) => main?.resolution?.values.includes(value) ?? false),
      maskEditing: option.maskEditing,
      price: option.price,
      available: hasKey && !missing,
      unavailableReason: missing
        ? `已安裝的 ${option.provider} 套件不包含 ${option.model}`
        : hasKey
          ? null
          : `伺服器未設定 ${secretNames(option.provider)[0] ?? option.provider}`,
    };
  }

  function findOption(appModelId: string): ImageModelOption | undefined {
    return config.models.find((option) => option.id === appModelId);
  }

  async function prepareReferences(images: string[], info: ImageModelInfo, base: ImageErrorDetails): Promise<string[]> {
    const fail = (index: number, problem: string): AppImageError =>
      new AppImageError(`第 ${index + 1} 張參考圖無法送出給 ${info.id}：${problem}。`, { ...base, code: 'invalid_reference' }, { httpStatus: 400 });
    const target = { acceptedMimeTypes: info.referenceImages.acceptedMimeTypes, maxInlineBytes: info.referenceImages.maxInlineBytes };
    return Promise.all(
      images.map(async (image, index) => {
        const problem = referenceProblem(image, info);
        if (!problem) return image;
        if (!config.convertReference) throw fail(index, problem);
        const converted = await config.convertReference(image, target).catch((error: unknown) => {
          throw fail(index, `${problem}，轉換失敗（${error instanceof Error ? error.message : String(error)}）`);
        });
        const remaining = referenceProblem(converted, info);
        if (remaining) throw fail(index, `轉換後仍然${remaining}`);
        return converted;
      }),
    );
  }

  function validTemperature(value: unknown, info: ImageModelInfo, label: string, base: ImageErrorDetails): number | undefined {
    if (value === undefined || value === null) return undefined;
    const invalid = (message: string): AppImageError => new AppImageError(message, { ...base, code: 'invalid_request' }, { httpStatus: 400 });
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('temperature 必須是數字。');
    if (!info.temperature) {
      throw new AppImageError(`${label} 不支援 Temperature。${TEMPERATURE_SUPPORT_NOTE}`, { ...base, code: 'temperature_unsupported' }, { httpStatus: 400 });
    }
    if (value < info.temperature.min || value > info.temperature.max) {
      throw invalid(`${label} 的 temperature 必須介於 ${info.temperature.min} 至 ${info.temperature.max}，收到 ${value}。`);
    }
    return value;
  }

  function resolutionFor(info: ImageModelInfo, requested: OutputResolution | undefined, label: string, base: ImageErrorDetails): string | undefined {
    if (requested === undefined) return undefined;
    if (info.resolution?.values.includes(requested)) return requested;
    if (STRICT_RESOLUTIONS.includes(requested)) {
      throw new AppImageError(`${label} 不支援 ${requested} 解像度，請改選其他模型或解像度。`, { ...base, code: 'resolution_unsupported' }, { httpStatus: 400 });
    }
    return undefined;
  }

  function aspectFor(info: ImageModelInfo, request: ImageRequest, imageCount: number, resolution: string | undefined, base: ImageErrorDetails): string | undefined {
    const kept = request.keepInputAspect ? inputAspectValue(info, resolution, imageCount) : null;
    if (kept !== null) return kept;
    const target = request.aspectRatio === undefined ? undefined : ratioValue(request.aspectRatio);
    if (target === undefined) {
      throw new AppImageError(`無法判斷圖片比例（收到「${request.aspectRatio ?? ''}」），無法為 ${info.id} 選擇比例。`, { ...base, code: 'invalid_request' }, { httpStatus: 400 });
    }
    return pickAspectRatio(info, target, resolution);
  }

  async function prepare(request: ImageRequest): Promise<PreparedImageRequest> {
    const option = findOption(request.appModelId);
    if (!option) {
      throw new AppImageError(`不支援的圖片模型「${request.appModelId}」，請在模型選單重新選擇。`, { code: 'unsupported_model', appModelId: request.appModelId }, { httpStatus: 400 });
    }
    const base: ImageErrorDetails = { appModelId: option.id, provider: option.provider };
    const parts = partsToPrompt(request.parts);
    const model = parts.referenceImages.length === 0 && option.textOnlyModel ? option.textOnlyModel : option.model;
    const info = catalogueInfo(option.provider, model);
    if (!info) throw new AppImageError(`已安裝的 ${option.provider} 套件不包含 ${model}。`, { ...base, code: 'unsupported_model' }, { httpStatus: 400 });
    const target: ImageErrorDetails = { ...base, model: info.id };

    const apiKey = providerKey(option.provider);
    if (!apiKey) {
      const secret = secretNames(option.provider)[0] ?? option.provider;
      throw new AppImageError(`伺服器未設定 ${secret}，無法使用 ${option.label}。`, { ...target, code: 'missing_key' }, { httpStatus: 503 });
    }
    const temperature = validTemperature(request.temperature, info, option.label, target);
    const { min, max } = info.referenceImages;
    const count = parts.referenceImages.length;
    if (count < min || (max !== null && count > max)) {
      const limit = max === null ? `至少 ${min} 張` : `${min}–${max} 張`;
      throw new AppImageError(`${option.label} 接受 ${limit}參考圖，這次有 ${count} 張（圖片不會被自動刪減）。`, { ...target, code: 'reference_limit' }, { httpStatus: 400 });
    }

    const rules = request.systemInstruction?.trim() ?? '';
    const separateRules = info.systemInstruction === true && rules !== '';
    const prompt = separateRules || rules === '' ? parts.prompt : `${rules}\n\n${parts.prompt}`;
    if (info.promptMaxLength !== null && prompt.length > info.promptMaxLength) {
      throw new AppImageError(
        `${option.label} 的 prompt 上限為 ${info.promptMaxLength.toLocaleString('en-US')} 字元，這次有 ${prompt.length.toLocaleString('en-US')} 字元。請縮短提示詞或改選其他模型。`,
        { ...target, code: 'prompt_too_long' },
        { httpStatus: 400 },
      );
    }
    const resolution = resolutionFor(info, request.resolution, option.label, target);
    const aspectRatio = aspectFor(info, request, count, resolution, target);
    return {
      appModelId: option.id,
      label: option.label,
      provider: option.provider,
      info,
      apiKey,
      prompt,
      systemInstruction: separateRules ? rules : undefined,
      referenceImages: await prepareReferences(parts.referenceImages, info, target),
      aspectRatio,
      resolution,
      temperature,
    };
  }

  function callProvider(prepared: PreparedImageRequest, signal: AbortSignal | undefined, clientBusinessId: string | undefined): Promise<ImageGenerationResult> {
    const common = {
      apiKey: prepared.apiKey,
      model: prepared.info.id,
      prompt: prepared.prompt,
      referenceImages: prepared.referenceImages,
      aspectRatio: prepared.aspectRatio,
      resolution: prepared.resolution,
      signal,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    };
    if (prepared.provider === 'google') {
      return generateGoogleImage({
        ...common,
        temperature: prepared.temperature,
        systemInstruction: prepared.systemInstruction,
        ...(config.googleHeaders ? { headers: config.googleHeaders } : {}),
      } as GoogleImageRequest);
    }
    if (prepared.provider === 'kie') return generateKieImage(common as KieImageRequest);
    return generateToapisImage({
      ...common,
      clientBusinessId,
      // Seedream adds a watermark by default; the apps never had one.
      watermark: prepared.info.watermark ? false : undefined,
    } as ToapisImageRequest);
  }

  async function run(prepared: PreparedImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    const clientBusinessId = prepared.provider === 'toapis' ? `${config.app}:${randomUUID()}` : undefined;
    try {
      const result = await callProvider(prepared, signal, clientBusinessId);
      console.info(
        `[usage] app=${config.app} model=${prepared.appModelId} ${result.provider}/${result.model} task=${result.taskId ?? '-'} ref=${clientBusinessId ?? '-'} elapsedMs=${result.elapsedMs} usage=${JSON.stringify(result.usage ?? null)}`,
      );
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
      return { dataUrl: image.dataUrl, provider: result.provider, model: result.model, taskId: result.taskId };
    } catch (error) {
      throw toAppError(error, prepared.appModelId);
    }
  }

  return {
    listModels: () => config.models.map(toView),
    findModel: (appModelId) => {
      const option = findOption(appModelId);
      return option ? toView(option) : undefined;
    },
    prepare,
    run,
  };
}

/** The parts of an Express response that streamImageResponse uses. */
export interface StreamingResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(): unknown;
  on(event: 'close', listener: () => void): unknown;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
}

/** The `complete` line's payload: the final image plus any extra fields the route returns. */
export type ImageStreamResult = { imageUrl: string } & Record<string, unknown>;

/** Keeps the connection busy so proxies with a 60-second idle timeout do not cut long image tasks. */
export const PING_INTERVAL_MS = 10_000;

/**
 * Streams one image request as NDJSON: a `start` line, a `ping` line every 10 s, then one
 * `complete` line (`imageUrl` and the route's extra fields) or `error` line (`error`, `details`).
 * When the client disconnects, `signal` aborts so provider polling stops; a task that was
 * already submitted is still billed by the provider. Call it after prepare() succeeded, so
 * validation errors can still be sent as plain JSON with their HTTP status.
 */
export async function streamImageResponse(
  res: StreamingResponse,
  work: (signal: AbortSignal) => Promise<ImageStreamResult>,
  pingIntervalMs: number = PING_INTERVAL_MS,
): Promise<void> {
  if (res.destroyed) {
    // The client left while the route was still preparing; nothing has been sent to a provider.
    console.info('[image] client disconnected before the request started; nothing was sent to the provider.');
    return;
  }
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (event: object): void => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const startedAt = Date.now();
  write({ type: 'start' });
  const timer = setInterval(() => write({ type: 'ping', elapsedSec: Math.round((Date.now() - startedAt) / 1000) }), pingIntervalMs);
  try {
    const result = await work(abort.signal);
    write({ ...result, type: 'complete' });
  } catch (error) {
    if (abort.signal.aborted) console.info('[image] request cancelled by the client:', error instanceof Error ? error.message : error);
    else console.error('[image] request failed:', error);
    write({ type: 'error', ...imageErrorBody(error) });
  } finally {
    clearInterval(timer);
    if (!res.writableEnded) res.end();
  }
}

/** The parts of an Express response that handleImageRequest uses. */
export interface ImageRouteResponse extends StreamingResponse {
  json(body: unknown): unknown;
}

/**
 * The whole server side of one image route: validates the request (errors go back as JSON with
 * HTTP 400 / 503, before any provider call), then streams the provider call as NDJSON.
 * `finish` turns the generated image into the `complete` payload (resize, stamp a logo, …).
 */
export async function handleImageRequest(
  res: ImageRouteResponse,
  client: ImageClient,
  request: ImageRequest,
  finish: (image: ImageResult) => Promise<ImageStreamResult>,
): Promise<void> {
  let prepared: PreparedImageRequest;
  try {
    prepared = await client.prepare(request);
  } catch (error) {
    console.warn('[image] request rejected:', error instanceof Error ? error.message : error);
    res.status(imageErrorStatus(error));
    res.json(imageErrorBody(error));
    return;
  }
  await streamImageResponse(res, async (signal) => finish(await client.run(prepared, signal)));
}
