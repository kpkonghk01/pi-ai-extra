export const TOAPIS_PROVIDER_ID = "toapis";
export const TOAPIS_PROVIDER_NAME = "ToAPIs";

/** Default host for uploads, image tasks and chat. Mainland China users may choose `https://api.toapis.cn` explicitly. */
export const TOAPIS_BASE_URL = "https://api.toapis.com";

export const TOAPIS_IMAGES_API = "pi-ai-extra-toapis-images";

/** The OpenAI-compatible parent path under a ToAPIs host; pi-ai appends `/responses` or `/chat/completions`. */
export function toapisOpenAIBaseUrl(host: string): string {
  return `${host}/v1`;
}
