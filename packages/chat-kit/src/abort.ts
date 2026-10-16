/** Settles like `promise`, or rejects with `reason()` as soon as `signal` aborts. The promise itself keeps running. */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined, reason: () => unknown): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(reason());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reason());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
