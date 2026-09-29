# Task: migrate Auto: OG 拼貼大師 image generation to `@hk01/pi-ai-extra-*`

You are editing **Auto: OG 拼貼大師（自動駕駛版）**, a React/Vite client with an Express `server.ts`. Follow this task exactly. Do not modify any package inside `node_modules`, do not modify build/start scripts, and do not change the text-generation pipeline.

Read [`README.md`](README.md) in this directory first. It is the source of truth for the package contract and model mapping.

## Goal

Keep the existing text model selector and direct Gemini text/article/title routes unchanged. Replace only direct image generation and image edit logic with the published server-only packages:

- `@hk01/pi-ai-extra-google`
- `@hk01/pi-ai-extra-kie`
- `@hk01/pi-ai-extra-toapis`

Users must choose image models from a new Provider-grouped image selector: Google, KIE, ToAPIs.

## Hard rules

1. **No image fallback.** A request uses exactly one selected provider/model. Delete Pro/Flash/Lite fallback lists, catch-and-continue loops, host loops, cross-provider upload fallback, reference-image slicing/filtering and automatic client retry. Never resend a billed image submission automatically.
2. **Text and image selectors are independent.** Do not change the existing text selector or direct Gemini title/article routes. Do not require title generation to use the selected image provider/model.
3. **Keys stay server-only.** Read `GEMINI_API_KEY`, `KIE_API_KEY`, `TOAPIS_API_KEY` in Express server code only. Remove Vite `define` entries that expose Gemini/API key values to browser code. Browser requests must not send keys, custom headers or base URLs.
4. **Keep existing prompt text and image post-processing.** Preserve every existing collage/edit prompt rule, role label, output JPEG resize/crop and ratio post-processing. Only replace provider transport code.
5. **Do not invent APIs.** Use only package main-entry exports documented in `docs/migration/auto-og/README.md`: `generateGoogleImage`, `generateKieImage`, `generateToapisImage`, package image model catalogues and `isPiAiExtraError`.
6. **Do not add cancellation UI or NDJSON progress** in this migration.

## 1. Add dependencies

Add the following exact dependencies to `package.json` without removing the existing `@google/genai` dependency, because text routes still use it:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.1.0/hk01-pi-ai-extra-google-0.1.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
```

## 2. Create one server-side image client

Create `server/providers/imageClient.ts`. It is the **only** module that imports the three image packages.

It must expose a function equivalent to:

```ts
generateAutoOgImage({
  appModelId,
  mode, // "collage" | "edit"
  prompt,
  referenceImages,
  ratio,
  quality,
  signal,
}): Promise<ImageGenerationResult>
```

Requirements:

- Map stable app model IDs to provider-native package model operations using the table in `README.md`.
- For KIE Grok and GPT Image 2, choose text-to-image only with zero references; choose their image-edit/image-to-image operation when references exist.
- For KIE Nano Banana 2, all ToAPIs models and Google models, use the listed model directly.
- Obtain the selected provider key from `process.env`; if missing, return a structured app error naming the provider and missing secret.
- Choose only a supported ratio/resolution from that model catalogue. If app ratio is unsupported, choose the nearest supported ratio; preserve existing browser post-processing.
- For ToAPIs, create a unique `clientBusinessId` such as `auto-og:<uuid>`.
- Return package `ImageGenerationResult` without dropping `taskId` or `usage`.
- Convert `PiAiExtraError` into a serializable app error with exactly: `provider`, `model`, `code`, `status`, `taskId`, `providerCode`, `message`.
- Never pass arbitrary `baseUrl`, `headers`, `fetch`, or package metadata from browser input.

## 3. Add the grouped image model catalogue and selector

Create a client-safe app image model config with stable app model IDs. It may include model label, provider, provider-native model mapping, known reference-image maximum and supported quality labels. Do not import package runtime modules into browser code.

Render image model options as:

```tsx
<select>
  <optgroup label="Google">...</optgroup>
  <optgroup label="KIE">...</optgroup>
  <optgroup label="ToAPIs">...</optgroup>
</select>
```

Keep the existing text model selector separate and unchanged.

For the current collage/edit request, calculate reference count before submit. Disable any image option with a documented max below that count; show an explanatory label such as `最多 5 張參考圖`. Models with no documented limit remain selectable and the provider remains the final validator. Never silently remove images to make a model selectable.

## 4. Rewrite collage image transport

Find `/api/generate-collage` and its direct Gemini image request. Keep all existing code that creates the prompt and asset role labels.

Build references in exactly this order:

```text
style template → source image 1 … N → brand logo (if present)
```

Call `generateAutoOgImage()` once using the selected app image model. Return the first package result image as the existing data URL response shape, while retaining task/usage in server logs. Delete all direct Gemini image model selection/fallback and response inlineData parsing from this route.

Do not change article extraction, title generation, text model selection, existing prompt wording, JPEG resize/crop or UI layout unrelated to the selector/error panel.

## 5. Rewrite edit image transport

Find `/api/edit-image` and its direct Gemini image request. Keep all current edit prompt text, especially mask instructions.

Build references in exactly this order:

```text
base image → mask (if present) → extra reference (if present)
```

Call `generateAutoOgImage()` once using `mode: "edit"` and the selected app image model. Treat mask as a reference image. Do not add Gemini fallback for providers that do not honour the mask perfectly; provider/model errors must be shown directly.

## 6. Server-only key boundary

- Remove browser-facing `GEMINI_API_KEY` / `API_KEY` injection from `vite.config.ts`.
- Keep `/api/config` limited to non-secret provider availability booleans.
- Do not expose secret value, prefix, custom endpoint or custom request header to browser code.

## 7. Persistent, dismissible error panel

Replace the current short-lived generic error toast for provider image errors with an unobtrusive panel:

- hidden normally;
- opens automatically on a provider error;
- shows provider, model, code, HTTP status, task ID and message when present;
- has buttons: `複製錯誤資訊`, `收起`, `關閉`;
- closing does not stop normal use; the next error opens the panel again.

The panel must not include API keys, request headers, full provider response bodies or signed image URLs.

## 8. Remove obsolete image code

Remove only image-generation-specific direct SDK code:

- image `GoogleGenAI` client construction and `generateContent` calls;
- image model fallback arrays and fallback catch loops;
- direct image response parsing;
- direct image upload/poll/download code;
- client image-generation automatic retry;
- browser key injection.

Keep `@google/genai` and all direct Gemini **text** routes.

## 9. Validate before reporting complete

1. Type-check and build the app.
2. Confirm text selector/title generation remain unchanged.
3. Confirm image dropdown has Google/KIE/ToAPIs groups and does not change text selection.
4. Run collage with template + source and multi-source + logo.
5. Run edit with base only, base + mask, base + mask + extra reference; inspect ordered references in server logs without logging data URLs.
6. Submit too many references for KIE Grok edit; it must show a limit error without dropping images.
7. Use an invalid KIE key; persistent error panel must show `kie`, selected model and error code, and copy only non-secret details.
8. Confirm a failed image request makes no fallback request to another provider/model.
9. Search browser output and built client assets for `GEMINI_API_KEY`, `KIE_API_KEY`, `TOAPIS_API_KEY`; none may be present.

When finished, report files changed, validation results, any provider/model whose output quality differs from Gemini, and any unresolved package/API mismatch. Do not claim a provider supports a feature that failed validation.
