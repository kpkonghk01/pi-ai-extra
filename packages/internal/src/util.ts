/** Returns a copy without `undefined` values (for optional fields under exactOptionalPropertyTypes). */
export function omitUndefined<T extends Record<string, unknown>>(input: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

export function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
