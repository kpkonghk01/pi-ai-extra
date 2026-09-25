# pi-ai-extra

Registry-free pnpm workspace for low-cost KIE and ToAPIs adapters built on [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai). It contains two independently installable, server-only packages:

- `@hk01/pi-ai-extra-kie`
- `@hk01/pi-ai-extra-toapis`

Each package exposes a pi-ai `Provider` factory for standard OpenAI Responses / Anthropic Messages endpoints and a Zod-validated high-level image helper for provider-specific image APIs. The packages do not read environment variables and do not contain API keys.

## Install from a GitHub Release

Install the exact `.tgz` asset released for the package. The app must run this on its server/build environment, never in browser code.

```sh
pnpm add https://github.com/<owner>/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz
```

Use the matching `toapis-vX.Y.Z` release and asset name for ToAPIs. Pin the full release URL for repeatable deploys. Roll back by restoring the previous URL.

The artifacts depend on `@earendil-works/pi-ai@0.87.1` and `zod@4.6.5`; pnpm installs those exact runtime dependencies normally.

## Google AI Studio server integration

1. Store the provider key in the app's **server-side Secret** configuration. Do not expose it through Vite, client code, or a browser request.
2. Import only from a server module.
3. Create a provider or call the image helper with the key explicitly.
4. Show `{ provider, model }` in application error logs/UI. Do not retry through another model or provider.

```ts
import { createKieProvider, generateKieImage } from "@hk01/pi-ai-extra-kie";

const provider = createKieProvider({
  apiKey: process.env.KIE_API_KEY!,
});

const generated = await generateKieImage({
  apiKey: process.env.KIE_API_KEY!,
  model: "nano-banana-2",
  prompt: "Create a square Open Graph image in Traditional Chinese.",
  aspectRatio: "1:1",
  referenceImages: [sourceDataUrl],
  signal: request.signal,
});

const imageDataUrl = generated.images[0];
```

The ToAPIs flow is equivalent:

```ts
import { generateToapisImage } from "@hk01/pi-ai-extra-toapis";

const generated = await generateToapisImage({
  apiKey: process.env.TOAPIS_API_KEY!,
  model: "gpt-image-2.5-flare",
  prompt: "Create an Open Graph image.",
  aspectRatio: "16:9",
  resolution: "1K",
  referenceImages: [sourceDataUrl],
  signal: request.signal,
});
```

Both helpers upload inline reference images through the selected provider only, wait for the same provider's terminal task status, and return base64 data URLs. A request that exceeds the selected model's documented reference-image limit fails rather than silently discarding images.

## Provider factories

Provider factories are for apps that already own a pi-ai `Models` collection:

```ts
import { createModels } from "@earendil-works/pi-ai";
import { createToapisProvider } from "@hk01/pi-ai-extra-toapis";

const models = createModels();
models.setProvider(createToapisProvider({
  apiKey: process.env.TOAPIS_API_KEY!,
}));
```

The factories register documented image models plus configurable chat model definitions. KIE GPT and ToAPIs Codex models use OpenAI Responses. KIE and ToAPIs Claude models use Anthropic Messages. Use the high-level image helpers when the image request needs model-specific options.

## Release workflow

Push an immutable tag after updating one package manifest:

```sh
git tag kie-v0.1.0
git push origin kie-v0.1.0
```

`kie-vX.Y.Z` releases `@hk01/pi-ai-extra-kie`; `toapis-vX.Y.Z` releases `@hk01/pi-ai-extra-toapis`. The GitHub Actions workflow verifies the tag equals that package's `package.json` version, checks and builds the package, packs its `.tgz`, and creates a GitHub Release. It uses only the repository's `GITHUB_TOKEN`.

## Development

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm run build
```

The workspace deliberately excludes Wokey. It also never performs provider fallback, model fallback, or cross-provider file-storage fallback.
