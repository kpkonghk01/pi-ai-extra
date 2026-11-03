import { createChatKit } from '@hk01/pi-ai-extra-chat-kit';
import { createGoogleProvider } from '@hk01/pi-ai-extra-google/pi-ai';
import { createKieProvider } from '@hk01/pi-ai-extra-kie/pi-ai';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { ImagePart } from '@hk01/pi-ai-extra-image-kit/server';
import { DEFAULT_ANALYSIS_MODEL_ID, type AnalysisModelView } from '../src/types';

/**
 * Analysis step models (/api/analyze-og): the text models that read the template, the source
 * images and the logo, and write the brief the image model follows. The user picks one in the
 * header. The server never runs the analysis on another one in their place: no retry, no other
 * model, no other provider. The list is owned here: the browser sends a key, and an unknown key
 * is refused.
 */

type ChatProviders = Parameters<typeof createChatKit>[0]['providers'];

/** Each provider once: its label, the server secret that holds its key, and its chat kit factory. */
const PROVIDERS = {
  kie: { label: 'KIE', secret: 'KIE_API_KEY', create: (apiKey: string) => createKieProvider({ apiKey }) },
  google: { label: 'Google', secret: 'GEMINI_API_KEY', create: (apiKey: string) => createGoogleProvider({ apiKey }) },
} satisfies Record<string, { label: string; secret: string; create: (apiKey: string) => ChatProviders[number] }>;

type AnalysisProvider = keyof typeof PROVIDERS;

export interface AnalysisModelOption {
  /** `provider:modelId`, stored in the browser's state. */
  key: string;
  provider: AnalysisProvider;
  /** The model id the provider's chat kit entry knows. */
  modelId: string;
  label: string;
}

const OPTIONS: readonly AnalysisModelOption[] = [
  { key: 'kie:gemini-3-8-flash', provider: 'kie', modelId: 'gemini-3-8-flash', label: 'Gemini 3.8 Flash' },
  { key: 'kie:gemini-3-6-flash', provider: 'kie', modelId: 'gemini-3-6-flash', label: 'Gemini 3.6 Flash' },
  { key: 'kie:gemini-4-argon', provider: 'kie', modelId: 'gemini-4-argon', label: 'Gemini 4 Argon' },
  { key: 'kie:claude-sonnet-5-5', provider: 'kie', modelId: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { key: 'kie:gpt-6-luna', provider: 'kie', modelId: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { key: 'google:gemini-3.8-flash', provider: 'google', modelId: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];

/**
 * The provider's API key from the server's secrets. A process's environment does not change
 * after it starts: AI Studio sets the secrets when it starts the server, and server.ts loads
 * `.env` once.
 */
function apiKeyOf(provider: AnalysisProvider): string | undefined {
  return process.env[PROVIDERS[provider].secret]?.trim() || undefined;
}

/** The name of the secret the server lacks for this provider, if it lacks it. */
function missingSecret(provider: AnalysisProvider): string | undefined {
  return apiKeyOf(provider) === undefined ? PROVIDERS[provider].secret : undefined;
}

export function listAnalysisModels(): AnalysisModelView[] {
  return OPTIONS.map((option) => {
    const missing = missingSecret(option.provider);
    return {
      key: option.key,
      label: option.label,
      providerLabel: PROVIDERS[option.provider].label,
      available: missing === undefined,
      ...(missing === undefined ? {} : { reason: `伺服器未設定 ${missing}` }),
    };
  });
}

export interface AnalysisErrorBody {
  error: string;
  details: { appModelId?: string; provider?: string; model?: string; code?: string; status?: number };
}

/** A failed analysis: the HTTP status and the body the route answers with (the ErrorPanel shows the details). */
export class AnalysisFailure extends Error {
  readonly status: number;
  readonly body: AnalysisErrorBody;
  constructor(status: number, body: AnalysisErrorBody) {
    super(body.error);
    this.name = 'AnalysisFailure';
    this.status = status;
    this.body = body;
  }
}

/** The model's part of a failure's details, in the shape the image routes use. */
export function analysisDetails(option: AnalysisModelOption): AnalysisErrorBody['details'] {
  return { appModelId: option.key, provider: option.provider, model: option.modelId };
}

/**
 * The model the browser asked for (the default when it asked for none), or an `AnalysisFailure`:
 * 400 for a key the server does not offer, 503 when the server lacks the provider's secret.
 */
export function resolveAnalysisModel(requested: unknown): AnalysisModelOption {
  const key = requested === undefined ? DEFAULT_ANALYSIS_MODEL_ID : String(requested);
  const option = OPTIONS.find((candidate) => candidate.key === key);
  if (!option) {
    throw new AnalysisFailure(400, { error: `未知的分析模型：${key}`, details: { code: 'unknown_analysis_model' } });
  }
  const missing = missingSecret(option.provider);
  if (missing !== undefined) {
    throw new AnalysisFailure(503, {
      error: `伺服器未設定 ${missing}，無法使用 ${PROVIDERS[option.provider].label} 的 ${option.label}。請在設定中確認金鑰。`,
      details: { ...analysisDetails(option), code: 'missing_key' },
    });
  }
  return option;
}

let kit: ReturnType<typeof createChatKit> | undefined;

/**
 * The chat kit, with a provider for every key the server has. Built once, on first use: not when
 * this module loads, which happens before server.ts has loaded `.env`.
 */
function chatKit() {
  kit ??= createChatKit({
    providers: (Object.keys(PROVIDERS) as AnalysisProvider[]).flatMap((provider) => {
      const apiKey = apiKeyOf(provider);
      return apiKey === undefined ? [] : [PROVIDERS[provider].create(apiKey)];
    }),
  });
  return kit;
}

/**
 * The chat kit's error text with a provider's JSON error body (`[kie/model] 401: {"error":...}`)
 * replaced by the message inside it, so the modal shows a sentence rather than JSON.
 */
function providerErrorText(reported: string): string {
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
 * the turn's cost, marked as reported by the provider or estimated.
 */
export async function runAnalysis(
  option: AnalysisModelOption,
  parts: readonly ImagePart[],
  signal: AbortSignal,
): Promise<string | undefined> {
  const content = parts.map((part): TextContent | ImageContent =>
    part.inlineData
      ? { type: 'image', data: part.inlineData.data, mimeType: part.inlineData.mimeType }
      : { type: 'text', text: part.text ?? '' },
  );
  const started = Date.now();
  const message = await chatKit().completeSimple(
    { provider: option.provider, id: option.modelId },
    { messages: [{ role: 'user', content, timestamp: Date.now() }] },
    { maxRetries: 0, signal },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const usage = message.chatKit.usage;
  const cost = usage?.costUsd === undefined ? 'n/a' : `US$${usage.costUsd} (${usage.costSource})`;
  const outcome = message.stopReason === 'error' ? `failed ${message.chatKit.error.code}` : message.stopReason;
  console.log(`[analyze-og] ${option.key} ${outcome} ${seconds}s cost=${cost}`);

  if (message.stopReason === 'aborted') return undefined;
  if (message.stopReason === 'error') {
    const { code, status } = message.chatKit.error;
    const reported = providerErrorText(message.errorMessage ?? `分析模型回報失敗 (${code})`);
    const text = reported.includes('User location is not supported')
      ? '地區連線限制 (User location is not supported)。請確認伺服器環境部署位置或稍後重試。'
      : reported;
    throw new AnalysisFailure(502, {
      error: text,
      details: { ...analysisDetails(option), code, ...(status === undefined ? {} : { status }) },
    });
  }
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}
