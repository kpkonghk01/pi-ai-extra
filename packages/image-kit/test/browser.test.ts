import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  fetchImageModels,
  formatErrorReport,
  ImageRequestError,
  isAbort,
  postImageRequest,
  reportError,
  subscribeErrors,
} from '../src/browser.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

function respondWith(response: Response): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
  return calls;
}

describe('postImageRequest', () => {
  it('returns the complete payload, even when lines are split across chunks', async () => {
    const calls = respondWith(
      new Response(streamOf(['{"type":"start"}\n{"type":"pi', 'ng","elapsedSec":10}\n{"type":"comp', 'lete","imageUrl":"data:x","metadata":{"ratio":"16:9"}}\n'])),
    );
    const result = await postImageRequest('/api/x', { a: 1 });
    assert.deepEqual(result, { imageUrl: 'data:x', metadata: { ratio: '16:9' } });
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal(calls[0]?.init?.body, '{"a":1}');
  });

  it('accepts a final line without a trailing newline', async () => {
    respondWith(new Response(streamOf(['{"type":"start"}\n{"type":"complete","imageUrl":"data:y"}'])));
    assert.deepEqual(await postImageRequest('/api/x', {}), { imageUrl: 'data:y' });
  });

  it('throws the streamed error with its details', async () => {
    respondWith(new Response(streamOf(['{"type":"start"}\n{"type":"error","error":"kie/x 失敗","details":{"provider":"kie","code":"auth"}}\n'])));
    await assert.rejects(postImageRequest('/api/x', {}), (error: unknown) => {
      assert.ok(error instanceof ImageRequestError);
      assert.equal(error.message, 'kie/x 失敗');
      assert.deepEqual(error.details, { provider: 'kie', code: 'auth' });
      assert.equal(error.httpStatus, undefined);
      return true;
    });
  });

  it('throws validation errors with the HTTP status', async () => {
    respondWith(Response.json({ error: '最多 5 張', details: { code: 'reference_limit' } }, { status: 400 }));
    await assert.rejects(postImageRequest('/api/x', {}), (error: unknown) => {
      assert.ok(error instanceof ImageRequestError);
      assert.equal(error.httpStatus, 400);
      assert.equal(error.details.code, 'reference_limit');
      return true;
    });
  });

  it('reports a stream that ends without a result, with what it could not parse', async () => {
    respondWith(new Response(streamOf(['{"type":"start"}\n<html>gateway timeout</html>\n'])));
    await assert.rejects(postImageRequest('/api/x', {}), (error: unknown) => {
      assert.ok(error instanceof ImageRequestError);
      assert.equal(error.details.code, 'stream_ended');
      assert.match(error.message, /<html>gateway timeout/);
      return true;
    });
  });

  it('rejects a complete line without an image', async () => {
    respondWith(new Response(streamOf(['{"type":"complete"}\n'])));
    await assert.rejects(postImageRequest('/api/x', {}), (error: unknown) => error instanceof ImageRequestError && error.details.code === 'no_output');
  });

  it('rethrows a cancellation as is', async () => {
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as typeof fetch;
    await assert.rejects(postImageRequest('/api/x', {}, controller.signal), (error: unknown) => isAbort(error, controller.signal) && !(error instanceof ImageRequestError));
  });

  it('wraps network failures', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await assert.rejects(postImageRequest('/api/x', {}), (error: unknown) => error instanceof ImageRequestError && error.details.code === 'network');
  });
});

describe('fetchImageModels', () => {
  it('returns the models array for one route-owned scope', async () => {
    const calls = respondWith(Response.json({ models: [{ id: 'a' }] }));
    assert.deepEqual(await fetchImageModels('collage'), [{ id: 'a' }]);
    assert.equal(calls[0]?.url, '/api/image-models?scope=collage');
  });

  it('rejects a body without models', async () => {
    respondWith(Response.json({}));
    await assert.rejects(fetchImageModels('editor'), (error: unknown) => error instanceof ImageRequestError && error.details.code === 'invalid_response');
  });
});

describe('error reporter', () => {
  it('delivers errors to subscribers, replays the latest, and formats a report', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeErrors((entry) => seen.push(entry.message));
    const entry = reportError(new ImageRequestError('壞了', { provider: 'toapis', model: 'gpt-image-2', code: 'auth', taskId: 't9' }, 400), '圖卡生成', {
      圖卡: '第 2/5 張',
      skipped: undefined,
    });
    unsubscribe();
    assert.deepEqual(seen, ['壞了']);

    const replayed: string[] = [];
    subscribeErrors((latest) => replayed.push(latest.operation))();
    assert.deepEqual(replayed, ['圖卡生成']);

    const report = formatErrorReport(entry);
    assert.match(report, /^操作: 圖卡生成$/m);
    assert.match(report, /^Provider\/model: toapis\/gpt-image-2$/m);
    assert.match(report, /^Error code: auth$/m);
    assert.match(report, /^App HTTP status: 400$/m);
    assert.match(report, /^Task id: t9$/m);
    assert.match(report, /^圖卡: 第 2\/5 張$/m);
    assert.doesNotMatch(report, /skipped/);
  });
});
