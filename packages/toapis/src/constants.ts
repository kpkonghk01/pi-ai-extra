export const TOAPIS_PROVIDER_ID = "toapis";
export const TOAPIS_PROVIDER_NAME = "ToAPIs";

/** Default host for uploads, image tasks and chat. Mainland China users may choose `https://toapis.cn` explicitly. */
export const TOAPIS_BASE_URL = "https://toapis.com";

export const TOAPIS_IMAGES_API = "pi-ai-extra-toapis-images";

/** OpenAI Responses parent path under a ToAPIs host; pi-ai appends `/responses`. */
export function toapisResponsesBaseUrl(host: string): string {
  return `${host}/v1`;
}
