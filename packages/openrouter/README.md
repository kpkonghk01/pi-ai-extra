# @hk01/pi-ai-extra-openrouter

Server-only extension to `@earendil-works/pi-ai`: `createOpenRouterProvider({ apiKey, baseUrl?, fetch? })` extends pi-ai's built-in `openrouterProvider()` (its `openrouter` id, catalogue, OpenAI Completions and Anthropic Messages adapters, and image and classifier models) with an explicit key instead of `OPENROUTER_API_KEY` and OAuth, a live model list, and the traits the [chat kit](https://github.com/kpkonghk01/pi-ai-extra#chat-kit) needs.

- `/pi-ai` subpath only (ESM only, needs `@earendil-works/pi-ai@1.2.0`): pi-ai already serves OpenRouter's image generation, so there is no main entry.
- `refreshModels` reads OpenRouter's public `GET <root>/v1/models` and replaces the chat models with every model that answers in text, so a model OpenRouter drops disappears.
- `chatKit` marks what OpenRouter takes (PDF and image documents, tools, native structured output on its Anthropic Messages route), which models the chat kit offers (not `:free`, `:batch`, routers, `-latest` aliases or image-output models), what each model reads (`file` input and `tools` from the live list) and its price. A turn's cost is OpenRouter's own `usage.cost`, else estimated.

```ts
import { createModels } from "@earendil-works/pi-ai";
import { createOpenRouterProvider } from "@hk01/pi-ai-extra-openrouter/pi-ai";

const models = createModels();
models.setProvider(createOpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY! })); // server-side secret, passed explicitly
await models.refresh({ providers: ["openrouter"] });
```

The key is always an explicit argument; the package never reads a key or setting of its own from environment variables (the SDKs underneath read a few; the [root README](https://github.com/kpkonghk01/pi-ai-extra#chat-providers-and-createchatkit) lists them, and says which of them the chat kit suppresses; this package alone suppresses none) and must not be imported into browser code. Install the pinned GitHub Release asset (`openrouter-vX.Y.Z`). The full guide: https://github.com/kpkonghk01/pi-ai-extra#readme
