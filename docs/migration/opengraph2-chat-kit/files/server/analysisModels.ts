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
