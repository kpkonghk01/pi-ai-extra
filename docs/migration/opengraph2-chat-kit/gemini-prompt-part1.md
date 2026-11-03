# opengraph2: move the Analysis step to the chat kit — part 1 of 3: Packages and clean-up

You are editing this Google AI Studio app, "OpenGraph2 圖片製作大師" (opengraph2). Its server already generates images through `@hk01/pi-ai-extra-image-kit`.

This is **part 1 of 3**. The three parts move the app's *Analysis step* (`/api/analyze-og`: a text model reads the template, the source images and the logo, and writes the brief the image model follows) from the Gemini SDK to `@hk01/pi-ai-extra-chat-kit`, so that the user can pick which model runs it (KIE Gemini, KIE Claude, KIE GPT or Google Gemini). Part 1 upgrades the packages and removes three workarounds. Parts 2 and 3 follow in separate messages. **Do not start on them.** The app can generate images again after part 3 only; until then, do not test it by generating.

## Rules

1. **Change only what the steps say.** Keep every prompt text, label, layout and style exactly as it is.
2. **No fallback and no retry.** Do not add another model, another provider or a second attempt anywhere. The user chooses; the app never chooses for them.
3. **Do not edit history.** Do not edit Markdown files (`*.md`), and do not edit anything inside a folder whose name contains `migration` (for example `pi-ai-extra-migration/`). They hold notes and snapshots from earlier migrations.
4. **A Find is exact.** Each "Find" text must occur in the file exactly the number of times the step says (once unless stated). If it does not, **stop and report which step and what you found instead.** Do not guess and do not edit something similar.
5. Copy the "Replace with" text exactly, including indentation. Do not reformat, rename or "improve" it.
6. If something does not fit the steps, describe it in your final report instead of fixing it.

## Step 1.1: Upgrade google and kie, add the chat kit and pi-ai

File: `package.json`

Why: The Analysis step moves to the chat kit. google 0.8.0 and kie 0.7.0 are the versions it needs (kie 0.7.0 adds the KIE Gemini models); pi-ai 1.2.0 is the chat kit's required peer.

**Find** (edit 1 of 3): this text occurs **3 times** in `package.json`:

```json
https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.7.0/hk01-pi-ai-extra-google-0.7.0.tgz
```

**Replace with**: Replace all 3 occurrences with it.

```json
https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.8.0/hk01-pi-ai-extra-google-0.8.0.tgz
```

**Find** (edit 2 of 3): this text occurs **3 times** in `package.json`:

```json
https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.6.0/hk01-pi-ai-extra-kie-0.6.0.tgz
```

**Replace with**: Replace all 3 occurrences with it.

```json
https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.7.0/hk01-pi-ai-extra-kie-0.7.0.tgz
```

**Find** (edit 3 of 3): this text occurs exactly once in `package.json`:

```json
    "@google/genai": "^1.29.0",
```

**Replace with**:

```json
    "@earendil-works/pi-ai": "1.2.0",
    "@google/genai": "^1.29.0",
    "@hk01/pi-ai-extra-chat-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/chat-kit-v0.4.1/hk01-pi-ai-extra-chat-kit-0.4.1.tgz",
```

## Step 1.2: Remove the postinstall script

File: `package.json`

Why: It patched the google package in node_modules to call /v1beta. Google's /v1 route works for Nano Banana 2.1 (checked with a real call), so the patch is not needed.

**Find**: this text occurs exactly once in `package.json`:

```json
    "lint": "tsc --noEmit",
    "postinstall": "node scripts/patch-google-extra.cjs"
```

**Replace with**:

```json
    "lint": "tsc --noEmit"
```

## Step 1.3: Delete the google patch script

File: `scripts/patch-google-extra.cjs`

Why: Nothing runs it after the previous step. Delete the file; delete the `scripts` folder too if it is then empty.

Delete the file `scripts/patch-google-extra.cjs`. If its folder is then empty, delete the folder too.

## Step 1.4: Remove the /v1 to /v1beta fetch rewrite

File: `server/imageModels.ts`

Why: It rewrote Google's Nano Banana 2.1 URLs to /v1beta. /v1 answers correctly, and the image kit sends the request the way the google package defines it.

**Find** (edit 1 of 2): this text occurs exactly once in `server/imageModels.ts`:

```ts
/**
 * Transparently rewrites any Gemini Nano Banana 2.1 API calls targeting /v1/models/gemini-nano-banana
 * to /v1beta/models/gemini-nano-banana, ensuring the Google Gemini API does not return HTTP 404.
 */
const patchedFetch: typeof globalThis.fetch = (input, init) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.includes('/v1/models/gemini-nano-banana')) {
    url = url.replace('/v1/models/gemini-nano-banana', '/v1beta/models/gemini-nano-banana');
    if (typeof input === 'string' || input instanceof URL) {
      return fetch(url, init);
    }
    return fetch(new Request(url, input), init);
  }
  return fetch(input, init);
};

export const imageClient = createImageClient({
```

**Replace with**:

```ts
export const imageClient = createImageClient({
```

**Find** (edit 2 of 2): this text occurs exactly once in `server/imageModels.ts`:

```ts
  googleHeaders: { 'User-Agent': 'aistudio-build' },
  fetch: patchedFetch,
```

**Replace with**:

```ts
  googleHeaders: { 'User-Agent': 'aistudio-build' },
```

## After the last step

Run `npm install` so that `package-lock.json` is updated, and make sure it finishes without an error.

## Checkpoint

Run `npm run lint`.

- An error that was already there before your changes is not yours (for example `'ErrorBoundary' cannot be used as a JSX component` in `src/App.tsx`). Report it, and leave it.
- Any other error comes from one of the steps above: fix your edit so it matches the step exactly, and run `npm run lint` again.

Then report: each step number with *done* or *stopped*, and the result of `npm run lint`.
