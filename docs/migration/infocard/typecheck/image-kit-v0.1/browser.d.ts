export function postImageRequest(url: string, payload: unknown, signal?: AbortSignal): Promise<{ imageUrl: string } & Record<string, unknown>>;
