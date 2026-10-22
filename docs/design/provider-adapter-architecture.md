# Provider adapter architecture

## Purpose

This repository centralises the KIE, ToAPIs and Gemini image integrations, and the KIE, ToAPIs, Gemini and OpenRouter chat integrations, that multiple AI Studio applications would otherwise implement independently. The detailed delivery and acceptance criteria live in [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513); downstream application adoption lives in [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512).

## Package map

```text
pi-ai-extra/
├── packages/
│   ├── internal/       private shared transport, validation, polling, usage and pi-ai bridge code
│   ├── kie/            @hk01/pi-ai-extra-kie
│   ├── toapis/         @hk01/pi-ai-extra-toapis
│   ├── google/         @hk01/pi-ai-extra-google (Gemini images; pi-ai has none)
│   ├── openrouter/     @hk01/pi-ai-extra-openrouter (pi-ai's OpenRouter provider with an explicit key and a live model list; /pi-ai only)
│   ├── image-kit/      @hk01/pi-ai-extra-image-kit (consumer image client over the three provider packages)
│   └── chat-kit/       @hk01/pi-ai-extra-chat-kit (server-side chat turns and live model lists on pi-ai over the chat providers the consumer registers)
├── examples/playground local-only live test page (not released)
├── referenc-docs/      provider source contracts
└── .github/workflows/  tag-to-GitHub-Release automation
```

`internal` is only a workspace/build dependency. The public build outputs bundle shared runtime code, so each public `.tgz` installs independently.

Each provider package (`kie`, `toapis`, `google`) has:

- **Main entry** (CommonJS and ESM): the image helper, catalogue, task lookup and errors. It has no pi-ai import.
- **`/pi-ai`** (ESM only): one pi-ai `Provider` factory serving the package's chat and image models. It returns a chat provider, with a `chatKit` member and a live model list ([ADR 0009](../adr/0009-chat-kit-contract-aligned-with-pi-ai.md)).

`openrouter` has only `/pi-ai`, because pi-ai already serves OpenRouter's images. See [ADR 0004](../adr/0004-dual-format-helper-esm-pi-ai-subpath.md) and its DATA-4583 amendment.

The two kits sit on the consumer side of the provider boundary. The image kit takes the three image provider packages as peer dependencies; the chat kit takes the provider packages as optional peers:

- **image-kit** ([ADR 0006](../adr/0006-image-kit-package.md), [ADR 0007](../adr/0007-catalogue-policy-model-selection.md)), CommonJS and ESM: model families from the installed catalogues through an app-owned catalogue policy, request validation and NDJSON streaming (`/server`, the only entry that imports the provider packages), a browser reader (`/browser`) and React UI (`/react`). It does not import pi-ai.
- **chat-kit** ([ADR 0008](../adr/0008-chat-kit-package.md), [ADR 0009](../adr/0009-chat-kit-contract-aligned-with-pi-ai.md)), ESM only: one server-only entry. It registers the chat providers the consumer builds with the factories. It runs a turn from pi-ai's `Context` to pi-ai's event stream, with the same documents, response schema, safety-block reporting, usage and cost on every provider. It lists each provider's live models as pi-ai `Model`s. It is the exception to ADR 0004's dual-format main entry, since it exists only to drive pi-ai (see that ADR's DATA-4567 amendment), and pi-ai is a required peer.

## Consumer boundary

A consumer app imports adapters on its server only. It reads a selected provider key from its own secret configuration and supplies it explicitly to the adapter helper/factory.

```text
Consumer server secret
        │
        ▼
KIE / ToAPIs / Google / OpenRouter adapter package
        │
        ├─ main entry: validated image operation → upload → task → final image + usage
        │              task lookup by id → status + usage (billing reconciliation)
        │              (none for OpenRouter, whose images pi-ai serves)
        └─ /pi-ai:     chat provider: pi-ai Provider with chatKit traits and a live model list;
                       chat (Responses / Messages / Completions / Gemini) and image models
        │
        ▼
Selected provider and model
```

The browser does not receive provider keys and does not import the adapter package.

## Image operation flow

1. The consumer chooses a single provider and model operation (a provider-native model id).
2. The helper validates the options that operation documents: prompt, ratio, resolution, background, output, and reference-image count, type and size, plus cross-field rules.
3. Inline reference images become provider-native public URLs through the selected provider only: KIE's base64 upload or ToAPIs' `/v1/uploads/images`. Gemini receives them inline.
4. The helper submits the task once. It then polls only that task until success, failure, timeout or cancellation. Only status polls, downloads and uploads are retried, and always against the same URL.
5. The helper downloads the final images promptly, checks their magic bytes and size, and returns data URLs together with provider-reported usage.

There is no provider fallback, model fallback, cross-provider upload fallback, or silent input truncation.

## Initial support matrix

| Adapter | Image operations | Chat protocols | Usage reported |
| --- | --- | --- | --- |
| KIE | Grok Imagine Image 2.0 text/edit; GPT Image 2 text/image; Nano Banana 2 | Codex via OpenAI Responses (`/openai/v1`); Claude via Anthropic Messages (`/anthropic`, Bearer) | `creditsConsumed`, `costTime` |
| ToAPIs | Gemini 3.1 Flash Image (preview); GPT Image 2; GPT Image 2.5 Flare/Sunburst; Seedream 5.0 Pro | Codex via OpenAI Responses; Claude via Anthropic Messages | `billing`, token `usage` |
| Google | Gemini 3.1 Flash Image; Gemini 3 Pro Image | Gemini via pi-ai's Gemini adapter and catalogue (explicit key) | `usageMetadata` |

Wokey is intentionally excluded from the first release because of the observed image-generation failure rate.

## Source documents

Use the committed provider files in [`referenc-docs/`](../../referenc-docs/) before adding or changing any model operation. The KIE index links to model-specific documents; a model is not considered supported merely because it appears in that index.

## Release path

A `kie-vX.Y.Z`, `toapis-vX.Y.Z`, `google-vX.Y.Z`, `openrouter-vX.Y.Z`, `image-kit-vX.Y.Z` or `chat-kit-vX.Y.Z` tag triggers the GitHub Actions release workflow. The workflow validates the corresponding package version, checks, builds, tests and packs it, installs the packed `.tgz` into a fresh project as a consumer would, then attaches it to a GitHub Release. For the kits, the smoke test installs packed copies of the provider packages they peer on (they are not on a registry): the image kit's three image provider packages, and the chat kit's optional provider peers. The image kit is loaded from `require()` and `import()` with React, and the chat kit, with pi-ai, from `import()` only (its `require()` must fail), lists every provider's models offline (each uses its installed catalogue or definitions) and runs one offline turn.

Related ADRs:

- [ADR 0001](../adr/0001-registry-free-package-releases.md): immutable artifact policy.
- [ADR 0002](../adr/0002-dual-layer-provider-contract.md): package API boundary.
- [ADR 0003](../adr/0003-explicit-provider-execution.md): BYOK and fallback policy.
- [ADR 0004](../adr/0004-dual-format-helper-esm-pi-ai-subpath.md): module formats.
- [ADR 0005](../adr/0005-provider-reported-usage.md): usage and billing.
- [ADR 0006](../adr/0006-image-kit-package.md) and [ADR 0007](../adr/0007-catalogue-policy-model-selection.md): the image kit and its catalogue policy.
- [ADR 0008](../adr/0008-chat-kit-package.md) and [ADR 0009](../adr/0009-chat-kit-contract-aligned-with-pi-ai.md): the chat kit and its pi-ai-aligned 0.3.0 contract.
