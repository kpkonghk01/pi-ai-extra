/** Same provider id as pi-ai's built-in Gemini chat provider: one Gemini API key serves both. */
export const GOOGLE_PROVIDER_ID = "google";
export const GOOGLE_PROVIDER_NAME = "Google Gemini";

/** Gemini API `generateContent` parent path for legacy image models. */
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Stable Gemini API `generateContent` parent path for Nano Banana 2.1. */
export const GOOGLE_V1_BASE_URL = "https://generativelanguage.googleapis.com/v1";

export const GOOGLE_IMAGES_API = "pi-ai-extra-google-images";

/** Same provider id as pi-ai's built-in Vertex AI provider (`google-vertex`). */
export const GOOGLE_VERTEX_PROVIDER_ID = "google-vertex";
export const GOOGLE_VERTEX_PROVIDER_NAME = "Google Agent Platform";

/**
 * Google Agent Platform (formerly Vertex AI) express-mode global endpoint: an API key, no project
 * or location. The Google GenAI SDK appends `publishers/google/models/<id>:streamGenerateContent`.
 */
export const GOOGLE_VERTEX_BASE_URL = "https://aiplatform.googleapis.com/v1";
