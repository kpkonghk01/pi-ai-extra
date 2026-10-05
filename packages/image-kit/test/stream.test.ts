import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeFetch, dataUrl, jsonResponse, PNG_BYTES } from '@hk01/pi-ai-extra-internal/testing';
import { AppImageError, createImageClient, handleImageRequest, streamImageResponse, type ImageRouteResponse } from '../src/server.ts';

class FakeResponse implements ImageRouteResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  jsonBody: unknown;
  json(body: unknown): this {
    this.jsonBody = body;
    this.writableEnded = true;
    return this;
  }
  writableEnded = false;
  destroyed = false;
  private closeListeners: Array<() => void> = [];
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  flushHeaders(): void {}
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): this {
    this.writableEnded = true;
    return this;
  }
  on(_event: 'close', listener: () => void): this {
    this.closeListeners.push(listener);
    return this;
  }
  /** The client went away: Node emits close without the response having ended. */
  disconnect(): void {
    this.destroyed = true;
    this.closeListeners.forEach((listener) => listener());
  }
  events(): Array<Record<string, unknown>> {
    return this.chunks.map((chunk) => JSON.parse(chunk) as Record<string, unknown>);
  }
}

const quiet = <T>(work: () => Promise<T>): Promise<T> => {
  const { error, info } = console;
  console.error = () => undefined;
  console.info = () => undefined;
  return work().finally(() => {
    console.error = error;
    console.info = info;
  });
};

describe('streamImageResponse', () => {
  it('streams start, pings while waiting, then the result', async () => {
    const res = new FakeResponse();
    await streamImageResponse(res, () => new Promise((resolve) => setTimeout(() => resolve({ imageUrl: 'data:image/png;base64,AA', extra: 1 }), 60)), 15);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/x-ndjson; charset=utf-8');
    const events = res.events();
    assert.deepEqual(events[0], { type: 'start' });
    assert.ok(events.filter((event) => event.type === 'ping').length >= 2);
    assert.deepEqual(events.at(-1), { imageUrl: 'data:image/png;base64,AA', extra: 1, type: 'complete' });
    assert.ok(res.writableEnded);
    assert.ok(res.chunks.every((chunk) => chunk.endsWith('\n')));
  });

  it('streams an error line with details instead of a result', async () => {
    const res = new FakeResponse();
    await quiet(() =>
      streamImageResponse(res, async () => {
        throw new AppImageError('kie/nano-banana-2 生成失敗 [timeout]：slow', { provider: 'kie', model: 'nano-banana-2', code: 'timeout', taskId: 't1' });
      }),
    );
    assert.deepEqual(res.events().at(-1), {
      type: 'error',
      error: 'kie/nano-banana-2 生成失敗 [timeout]：slow',
      details: { provider: 'kie', model: 'nano-banana-2', code: 'timeout', taskId: 't1' },
    });
  });

  it('never starts the work for a client that already disconnected', async () => {
    const res = new FakeResponse();
    res.disconnect();
    let started = false;
    await quiet(() =>
      streamImageResponse(res, async () => {
        started = true;
        return { imageUrl: 'x' };
      }),
    );
    assert.equal(started, false);
    assert.equal(res.chunks.length, 0);
  });

  it('aborts the work when the client disconnects', async () => {
    const res = new FakeResponse();
    let aborted = false;
    const done = quiet(() =>
      streamImageResponse(
        res,
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      ),
    );
    res.disconnect();
    await done;
    assert.ok(aborted);
    assert.equal(res.events().length, 1, 'nothing is written to a closed connection');
  });
});

describe('handleImageRequest', () => {
  const PNG = dataUrl(PNG_BYTES, 'image/png');
  const GOOGLE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent';
  const models = [{ id: 'nb2', label: 'NB2', description: '', provider: 'google' as const, model: 'gemini-3.1-flash-image', maskEditing: 'supported' as const, price: null }];

  it('answers validation errors with JSON and their HTTP status, without streaming', async () => {
    const res = new FakeResponse();
    const original = console.warn;
    console.warn = () => undefined;
    try {
      await handleImageRequest(res, createImageClient({ app: 't', models, env: {} }), { appModelId: 'nb2', parts: [{ text: 'x' }], aspectRatio: '1:1' }, async (image) => ({
        imageUrl: image.dataUrl,
      }));
    } finally {
      console.warn = original;
    }
    assert.equal(res.statusCode, 503);
    assert.equal((res.jsonBody as { details: { code: string } }).details.code, 'missing_key');
    assert.equal(res.chunks.length, 0);
  });

  it('streams the finished payload', async () => {
    const fake = createFakeFetch([
      {
        method: 'POST',
        url: GOOGLE_URL,
        respond: () => jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.split(',')[1] } }] } }] }),
      },
    ]);
    const client = createImageClient({ app: 't', models, env: { GEMINI_API_KEY: 'k' }, fetch: fake.fetch });
    const res = new FakeResponse();
    const original = console.info;
    console.info = () => undefined;
    try {
      await handleImageRequest(res, client, { appModelId: 'nb2', parts: [{ text: 'x' }], aspectRatio: '1:1' }, async (image) => ({ imageUrl: `${image.dataUrl}#done`, model: image.model }));
    } finally {
      console.info = original;
    }
    assert.deepEqual(res.events().at(-1), { imageUrl: `${PNG}#done`, model: 'gemini-3.1-flash-image', type: 'complete' });
  });
});
