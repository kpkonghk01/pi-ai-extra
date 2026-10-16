export const KIE_PROVIDER_ID = "kie";
export const KIE_PROVIDER_NAME = "KIE";

/** Market task API (`/api/v1/jobs/*`). */
export const KIE_API_BASE_URL = "https://api.kie.ai";
/** Documented host of the File Upload API (`/api/file-base64-upload`). */
export const KIE_UPLOAD_BASE_URL = "https://kieai.redpandaai.co";
/** Codex (OpenAI Responses) parent path; pi-ai appends `/responses` (documented `POST /codex/v1/responses`). */
export const KIE_RESPONSES_BASE_URL = "https://api.kie.ai/codex/v1";
/**
 * Claude (Anthropic Messages) base URL from KIE's Claude Code integration guide; pi-ai's
 * Anthropic adapter appends `/v1/messages`. The model pages still show `/claude/v1/messages`.
 */
export const KIE_CLAUDE_BASE_URL = "https://api.kie.ai/anthropic";

export const KIE_IMAGES_API = "pi-ai-extra-kie-images";
