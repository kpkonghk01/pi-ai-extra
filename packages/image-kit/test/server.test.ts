import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeFetch, dataUrl, GIF_BYTES, JPEG_BYTES, jsonResponse, PNG_BYTES } from '@hk01/pi-ai-extra-internal/testing';
import {
  AppImageError,
  createImageClient,
  imageErrorBody,
  imageErrorStatus,
  partsToPrompt,
  type ImageClientConfig,
  type ImageModelOption,
  type ImagePart,
  type ImageRequest,
} from '../src/server.ts';

const MODELS: readonly ImageModelOption[] = [
  { id: 'nano-banana-2', label: 'Nano Banana 2', description: '', provider: 'google', model: 'gemini-3.1-flash-image', maskEditing: 'supported', price: null },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', description: '', provider: 'google', model: 'gemini-3-pro-image', maskEditing: 'supported', price: null },
  { id: 'kie-nano-banana-2', label: 'Nano Banana 2 (KIE)', description: '', provider: 'kie', model: 'nano-banana-2', maskEditing: 'supported', price: null },
  {
    id: 'kie-gpt-image-2',
    label: 'GPT Image 2 (KIE)',
    description: '',
    provider: 'kie',
    model: 'gpt-image-2-image-to-image',
    textOnlyModel: 'gpt-image-2-text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-grok-imagine-2',
    label: 'Grok Imagine 2.0 (KIE)',
    description: '',
    provider: 'kie',
    model: 'grok-imagine-image-2-0/image-edit',
    textOnlyModel: 'grok-imagine-image-2-0/text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  { id: 'gpt-image-2', label: 'GPT Image 2 (ToAPIs)', description: '', provider: 'toapis', model: 'gpt-image-2', maskEditing: 'reference-only', price: null },
  { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 Preview (ToAPIs)', description: '', provider: 'toapis', model: 'gemini-3.1-flash-image-preview', maskEditing: 'supported', price: null },
  { id: 'doubao-seedream-5-0-pro', label: 'Seedream 5.0 Pro (ToAPIs)', description: '', provider: 'toapis', model: 'doubao-seedream-5-0-pro', maskEditing: 'reference-only', price: null },
  { id: 'gone', label: 'Removed model', description: '', provider: 'toapis', model: 'not-in-the-package', maskEditing: 'reference-only', price: null },
];

const KEYS = { GEMINI_API_KEY: 'gemini-key', KIE_API_KEY: 'kie-key', TOAPIS_API_KEY: 'toapis-key' };
const PNG = dataUrl(PNG_BYTES, 'image/png');
const JPEG = dataUrl(JPEG_BYTES, 'image/jpeg');
/** RIFF....WEBP header; enough for format detection. */
const WEBP = dataUrl(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]), 'image/webp');

function client(overrides: Partial<ImageClientConfig> = {}) {
  return createImageClient({ app: 'test-app', models: MODELS, env: KEYS, ...overrides });
}

function imagePart(url: string): ImagePart {
  const [header, data] = url.split(',');
  return { inlineData: { mimeType: header?.slice(5, header.indexOf(';')) ?? '', data: data ?? '' } };
}

/** A request with defaults; an override set to undefined leaves that field out. */
function request(overrides: { [K in keyof ImageRequest]?: ImageRequest[K] | undefined } = {}): ImageRequest {
  const merged = { appModelId: 'nano-banana-2', parts: [{ text: 'TEMPLATE:' }, imagePart(PNG), { text: 'Make a card.' }], aspectRatio: '4:5', ...overrides };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as unknown as ImageRequest;
}

async function rejectsWith(promise: Promise<unknown>, code: string, httpStatus: number): Promise<AppImageError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppImageError, `expected AppImageError, got ${String(error)}`);
    assert.equal(error.details.code, code);
    assert.equal(error.httpStatus, httpStatus);
    return error;
  }
  assert.fail(`expected ${code}`);
}

describe('createImageClient', () => {
  it('rejects duplicate model ids', () => {
    assert.throws(() => createImageClient({ app: 'x', models: [MODELS[0]!, MODELS[0]!], env: {} }), /duplicate model id "nano-banana-2"/);
  });
});

describe('listModels', () => {
  it('merges the app options with the package catalogues', () => {
    const models = client().listModels();
    assert.deepEqual(
      models.map((model) => model.id),
      MODELS.map((model) => model.id),
    );
    const byId = new Map(models.map((model) => [model.id, model]));
    assert.deepEqual(byId.get('nano-banana-2')?.resolutions, ['1K', '2K', '4K']);
    assert.deepEqual(byId.get('nano-banana-2')?.temperature, { min: 0, max: 2 });
    assert.equal(byId.get('kie-nano-banana-2')?.temperature, null);
    assert.deepEqual(byId.get('kie-grok-imagine-2')?.resolutions, []);
    assert.deepEqual(byId.get('kie-grok-imagine-2')?.referenceLimit, { min: 0, max: 5 });
    assert.deepEqual(byId.get('kie-gpt-image-2')?.referenceLimit, { min: 0, max: 16 });
    assert.deepEqual(byId.get('doubao-seedream-5-0-pro')?.resolutions, ['1K', '2K']);
    assert.deepEqual(byId.get('doubao-seedream-5-0-pro')?.acceptedMimeTypes, ['image/png', 'image/jpeg']);
    assert.equal(byId.get('gpt-image-2')?.providerLabel, 'ToAPIs 提供');
    assert.equal(byId.get('gone')?.available, false);
    assert.match(byId.get('gone')?.unavailableReason ?? '', /不包含 not-in-the-package/);
  });

  it('marks providers without a key as unavailable', () => {
    const models = client({ env: { GEMINI_API_KEY: 'g' } }).listModels();
    const kie = models.find((model) => model.id === 'kie-nano-banana-2');
    assert.equal(kie?.available, false);
    assert.equal(kie?.unavailableReason, '伺服器未設定 KIE_API_KEY');
    assert.equal(models.find((model) => model.id === 'nano-banana-2')?.available, true);
  });

  it('reads alternative secret names in order', () => {
    const toapis = client({ env: { TOAPI_API_KEY: 'legacy' }, secretNames: { toapis: ['TOAPIS_API_KEY', 'TOAPI_API_KEY'] } }).findModel('gpt-image-2');
    assert.equal(toapis?.available, true);
  });
});

describe('prepare: validation before any provider call', () => {
  it('rejects unknown model ids', async () => {
    await rejectsWith(client().prepare(request({ appModelId: 'openrouter-gpt-image-2' })), 'unsupported_model', 400);
  });

  it('rejects a provider without a key with 503', async () => {
    const error = await rejectsWith(client({ env: {} }).prepare(request({ appModelId: 'kie-nano-banana-2' })), 'missing_key', 503);
    assert.match(error.message, /KIE_API_KEY/);
  });

  it('accepts temperature only where the catalogue lists it, within its range', async () => {
    const prepared = await client().prepare(request({ temperature: 0.7 }));
    assert.equal(prepared.temperature, 0.7);
    await rejectsWith(client().prepare(request({ appModelId: 'kie-nano-banana-2', temperature: 0.7 })), 'temperature_unsupported', 400);
    await rejectsWith(client().prepare(request({ temperature: '0.7' })), 'invalid_request', 400);
    await rejectsWith(client().prepare(request({ temperature: 2.5 })), 'invalid_request', 400);
  });

  it('never drops reference images', async () => {
    const six = Array.from({ length: 6 }, () => imagePart(PNG));
    const error = await rejectsWith(client().prepare(request({ appModelId: 'kie-grok-imagine-2', parts: [{ text: 'x' }, ...six] })), 'reference_limit', 400);
    assert.match(error.message, /1–5 張/);
  });

  it('uses the text-only operation when there are no references', async () => {
    const prepared = await client().prepare(request({ appModelId: 'kie-grok-imagine-2', parts: [{ text: 'a car' }], aspectRatio: '4:5' }));
    assert.equal(prepared.info.id, 'grok-imagine-image-2-0/text-to-image');
    assert.equal(prepared.aspectRatio, '2:3');
    const withReference = await client().prepare(request({ appModelId: 'kie-grok-imagine-2' }));
    assert.equal(withReference.info.id, 'grok-imagine-image-2-0/image-edit');
  });

  it('rejects a prompt over the model limit before calling the provider', async () => {
    const long = 'x'.repeat(8_001);
    const error = await rejectsWith(client().prepare(request({ appModelId: 'kie-grok-imagine-2', parts: [imagePart(PNG), { text: long }] })), 'prompt_too_long', 400);
    assert.match(error.message, /8,000 字元/);
    const fits = await client().prepare(request({ appModelId: 'kie-grok-imagine-2', parts: [imagePart(PNG), { text: 'x'.repeat(7_900) }] }));
    assert.ok(fits.prompt.length <= 8_000);
  });

  it('counts the rules in the prompt length when they are prepended', async () => {
    const rules = 'r'.repeat(4_000);
    await rejectsWith(
      client().prepare(request({ appModelId: 'kie-grok-imagine-2', systemInstruction: rules, parts: [imagePart(PNG), { text: 'p'.repeat(4_000) }] })),
      'prompt_too_long',
      400,
    );
  });
});

describe('prepare: rules, resolution and aspect ratio', () => {
  it('sends rules as systemInstruction to Google and before the prompt elsewhere', async () => {
    const google = await client().prepare(request({ systemInstruction: 'RULES' }));
    assert.equal(google.systemInstruction, 'RULES');
    assert.equal(google.prompt, 'TEMPLATE:\n\n[Reference image 1]\n\nMake a card.');
    const kie = await client().prepare(request({ appModelId: 'kie-nano-banana-2', systemInstruction: 'RULES' }));
    assert.equal(kie.systemInstruction, undefined);
    assert.equal(kie.prompt, 'RULES\n\nTEMPLATE:\n\n[Reference image 1]\n\nMake a card.');
  });

  it('sends 4K only to models that list it and omits best-effort sizes elsewhere', async () => {
    assert.equal((await client().prepare(request({ resolution: '4K' }))).resolution, '4K');
    await rejectsWith(client().prepare(request({ appModelId: 'doubao-seedream-5-0-pro', resolution: '4K' })), 'resolution_unsupported', 400);
    await rejectsWith(client().prepare(request({ appModelId: 'kie-grok-imagine-2', resolution: '4K' })), 'resolution_unsupported', 400);
    assert.equal((await client().prepare(request({ appModelId: 'kie-grok-imagine-2', resolution: '2K' }))).resolution, undefined);
    assert.equal((await client().prepare(request({ appModelId: 'doubao-seedream-5-0-pro', resolution: '2K' }))).resolution, '2K');
  });

  it('sends a native ratio or the nearest one the model accepts', async () => {
    const aspect = async (appModelId: string, aspectRatio: string, resolution?: '1K' | '2K' | '4K') =>
      (await client().prepare(request({ appModelId, aspectRatio, resolution }))).aspectRatio;
    assert.equal(await aspect('nano-banana-2', '4:5'), '4:5');
    assert.equal(await aspect('nano-banana-2', '300x250'), '5:4');
    assert.equal(await aspect('nano-banana-2', '320x480'), '2:3');
    assert.equal(await aspect('doubao-seedream-5-0-pro', '300x250'), '4:3');
    assert.equal(await aspect('kie-gpt-image-2', '4:5', '2K'), '3:4');
    assert.equal(await aspect('kie-gpt-image-2', '4:5', '1K'), '4:5');
    assert.equal(await aspect('kie-gpt-image-2', '1:1', '4K'), '5:4');
    await rejectsWith(client().prepare(request({ aspectRatio: 'original' })), 'invalid_request', 400);
  });

  it('keeps the input aspect natively where it can, otherwise picks the nearest to the input', async () => {
    const keep = async (appModelId: string, aspectRatio?: string, resolution?: '1K' | '2K') =>
      (await client().prepare(request({ appModelId, keepInputAspect: true, aspectRatio, resolution }))).aspectRatio;
    assert.equal(await keep('nano-banana-2'), undefined);
    assert.equal(await keep('kie-nano-banana-2'), 'auto');
    assert.equal(await keep('kie-grok-imagine-2'), 'auto');
    assert.equal(await keep('kie-gpt-image-2', undefined, '1K'), 'auto');
    assert.equal(await keep('kie-gpt-image-2', '1200:675', '2K'), '16:9');
    assert.equal(await keep('gpt-image-2', '300:250'), '5:4');
    // ToAPIs does not document what it does without a size, so the input aspect is sent explicitly.
    assert.equal(await keep('gemini-3.1-flash-image-preview', '1080:1350'), '4:5');
    await rejectsWith(client().prepare(request({ appModelId: 'gpt-image-2', keepInputAspect: true, aspectRatio: undefined })), 'invalid_request', 400);
  });

  it('sends the input aspect explicitly when there is more than one image', async () => {
    const parts = [imagePart(PNG), { text: 'style' }, imagePart(JPEG), { text: 'edit' }];
    const keep = async (appModelId: string) =>
      (await client().prepare(request({ appModelId, parts, keepInputAspect: true, aspectRatio: '1080:1350' }))).aspectRatio;
    assert.equal(await keep('nano-banana-2'), '4:5');
    assert.equal(await keep('kie-nano-banana-2'), '4:5');
    assert.equal(await keep('kie-grok-imagine-2'), '2:3');
  });
});

describe('prepare: reference formats', () => {
  it('detects the real format, not the declared one', async () => {
    const mislabelled = imagePart(WEBP);
    const parts = [{ ...mislabelled, inlineData: { ...mislabelled.inlineData!, mimeType: 'image/png' } }];
    await rejectsWith(client().prepare(request({ appModelId: 'doubao-seedream-5-0-pro', parts })), 'invalid_reference', 400);
  });

  it('converts references the model cannot take, and only those', async () => {
    const seen: string[] = [];
    const convertReference = async (url: string, target: { acceptedMimeTypes: readonly string[] }) => {
      seen.push(url);
      assert.deepEqual(target.acceptedMimeTypes, ['image/png', 'image/jpeg']);
      return JPEG;
    };
    const prepared = await client({ convertReference }).prepare(request({ appModelId: 'doubao-seedream-5-0-pro', parts: [imagePart(PNG), imagePart(WEBP)] }));
    assert.deepEqual(prepared.referenceImages, [PNG, JPEG]);
    assert.deepEqual(seen, [WEBP]);
  });

  it('rejects a reference that is still unusable after conversion', async () => {
    const error = await rejectsWith(
      client({ convertReference: async () => dataUrl(GIF_BYTES, 'image/gif') }).prepare(request({ appModelId: 'doubao-seedream-5-0-pro', parts: [imagePart(WEBP)] })),
      'invalid_reference',
      400,
    );
    assert.match(error.message, /第 1 張.*轉換後仍然格式 image\/gif/);
  });

  it('rejects a reference over the inline size limit when there is no converter', async () => {
    const big = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}${'A'.repeat(14_000_000)}`;
    const error = await rejectsWith(client().prepare(request({ appModelId: 'gpt-image-2', parts: [{ inlineData: { mimeType: 'image/png', data: big.split(',')[1]! } }] })), 'invalid_reference', 400);
    assert.match(error.message, /超過上限 10 MB/);
  });
});

describe('partsToPrompt', () => {
  it('numbers images in order and keeps the text labels', () => {
    const { prompt, referenceImages } = partsToPrompt([{ text: 'A' }, imagePart(PNG), { text: 'B' }, imagePart(JPEG)]);
    assert.equal(prompt, 'A\n\n[Reference image 1]\n\nB\n\n[Reference image 2]');
    assert.deepEqual(referenceImages, [PNG, JPEG]);
  });
});

describe('run', () => {
  const GOOGLE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent';

  it('returns the generated image and sends the app headers to Google', async () => {
    const fake = createFakeFetch([
      {
        method: 'POST',
        url: GOOGLE_URL,
        respond: () => jsonResponse({ responseId: 'r1', candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.split(',')[1] } }] } }] }),
      },
    ]);
    const kit = client({ fetch: fake.fetch, googleHeaders: { 'User-Agent': 'aistudio-build' } });
    const result = await kit.run(await kit.prepare(request({ temperature: 0.4 })));
    assert.equal(result.dataUrl, PNG);
    assert.equal(result.provider, 'google');
    assert.equal(result.taskId, 'r1');
    const call = fake.calls[0];
    assert.equal(call?.headers['user-agent'], 'aistudio-build');
    const body = JSON.parse(String(call?.body)) as { generationConfig: { temperature: number; imageConfig: { aspectRatio: string } } };
    assert.equal(body.generationConfig.temperature, 0.4);
    assert.equal(body.generationConfig.imageConfig.aspectRatio, '4:5');
  });

  it('turns package errors into messages that name provider, model and code', async () => {
    const fake = createFakeFetch([{ method: 'POST', url: GOOGLE_URL, respond: () => jsonResponse({ error: { message: 'API key not valid' } }, 401) }]);
    const kit = client({ fetch: fake.fetch });
    await assert.rejects(kit.run(await kit.prepare(request())), (error: unknown) => {
      assert.ok(error instanceof AppImageError);
      assert.match(error.message, /^google\/gemini-3\.1-flash-image 金鑰無效或未授權/);
      assert.deepEqual({ ...error.details }, { appModelId: 'nano-banana-2', provider: 'google', model: 'gemini-3.1-flash-image', code: 'auth', status: 401 });
      assert.equal(imageErrorStatus(error), 500);
      assert.equal(imageErrorBody(error).details.code, 'auth');
      return true;
    });
    assert.equal(fake.calls.length, 1, 'a failed request is not re-sent');
  });

  it('attributes ToAPIs tasks to the app and turns the Seedream watermark off', async () => {
    const fake = createFakeFetch([{ method: 'POST', url: 'https://toapis.com/v1/images/generations', respond: () => jsonResponse({ error: { message: 'bad key' } }, 401) }]);
    const kit = client({ fetch: fake.fetch });
    await assert.rejects(kit.run(await kit.prepare(request({ appModelId: 'doubao-seedream-5-0-pro', parts: [{ text: 'a cat' }], resolution: '2K' }))));
    const body = JSON.parse(String(fake.calls[0]?.body)) as { client_business_id: string; metadata: { watermark: boolean; resolution: string } };
    assert.match(body.client_business_id, /^test-app:[0-9a-f-]{36}$/);
    assert.equal(body.metadata.watermark, false);
    assert.equal(body.metadata.resolution, '2K');
  });
});
