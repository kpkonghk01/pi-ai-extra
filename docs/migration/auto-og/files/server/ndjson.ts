import type { Response } from 'express';

/** Keeps the connection busy so proxies with a 60-second idle timeout do not cut long image tasks. */
const PING_INTERVAL_MS = 10_000;

/**
 * Streams one image request as NDJSON: a `start` line, a `ping` line every 10 s, then a single
 * `complete` line (`rawImageBase64`) or `error` line (`error`, `details`).
 * When the client disconnects, `signal` aborts so provider polling stops; a task that was
 * already submitted is still billed by the provider.
 */
export async function streamImageResponse(
  res: Response,
  work: (signal: AbortSignal) => Promise<{ rawImageBase64: string }>,
  describeError: (error: unknown) => { error: string; details: object },
): Promise<void> {
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
  const timer = setInterval(() => write({ type: 'ping', elapsedSec: Math.round((Date.now() - startedAt) / 1000) }), PING_INTERVAL_MS);
  try {
    const result = await work(abort.signal);
    write({ type: 'complete', ...result });
  } catch (error) {
    console.error('[image] request failed:', error);
    write({ type: 'error', ...describeError(error) });
  } finally {
    clearInterval(timer);
    if (!res.writableEnded) res.end();
  }
}
