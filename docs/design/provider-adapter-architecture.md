# Provider adapter architecture

## Purpose

This repository centralises the KIE, ToAPIs and Gemini image integrations, and the KIE/ToAPIs chat integrations, that multiple AI Studio applications would otherwise implement independently. The detailed delivery and acceptance criteria live in [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513); downstream application adoption lives in [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512).

## Package map

```text
pi-ai-extra/
├── packages/
│   ├── internal/       private shared transport, validation, polling, usage and pi-ai bridge code
│   ├── kie/            @hk01/pi-ai-extra-kie
│   ├── toapis/         @hk01/pi-ai-extra-toapis
│   └── google/         @hk01/pi-ai-extra-google (Gemini images; pi-ai has none)
├── examples/playground local-only live test page (not released)
├── referenc-docs/      provider source contracts
└── .github/workflows/  tag-to-GitHub-Release automation
```

`internal` is only a workspace/build dependency. The public build outputs bundle shared runtime code, so each public `.tgz` installs independently.

Each public package has:

- **Main entry** (CommonJS and ESM): the image helper, catalogue, task lookup and errors. It has no pi-ai import.
- **`/pi-ai`** (ESM only): the chat `Provider` and `ImagesProvider` factories.

See [ADR 0004](../adr/0004-dual-format-helper-esm-pi-ai-subpath.md).

## Consumer boundary

A consumer app imports adapters on its server only. It reads a selected provider key from its own secret configuration and supplies it explicitly to the adapter helper/factory.

```text
Consumer server secret
        │
        ▼
KIE / ToAPIs / Google adapter package
        │
        ├─ main entry: validated image operation → upload → task → final image + usage
        │              task lookup by id → status + usage (billing reconciliation)
        └─ /pi-ai:     chat Provider (Responses / Messages) and ImagesProvider for pi-ai collections
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
| KIE | Grok Imagine Image 2.0 text/edit; GPT Image 2 text/image; Nano Banana 2 | GPT Codex via OpenAI Responses (`/api/v1`); Claude via Anthropic Messages (`/claude`, Bearer) | `creditsConsumed`, `costTime` |
| ToAPIs | Gemini 3.1 Flash Image (preview); GPT Image 2; GPT Image 2.5 Flare/Sunburst; Seedream 5.0 Pro | Codex via OpenAI Responses; Claude via Anthropic Messages | `billing`, token `usage` |
| Google | Gemini 3.1 Flash Image; Gemini 3 Pro Image | pi-ai built-in `google` provider | `usageMetadata` |

Wokey is intentionally excluded from the first release because of the observed image-generation failure rate.

## Source documents

Use the committed provider files in [`referenc-docs/`](../../referenc-docs/) before adding or changing any model operation. The KIE index links to model-specific documents; a model is not considered supported merely because it appears in that index.

## Release path

A `kie-vX.Y.Z`, `toapis-vX.Y.Z` or `google-vX.Y.Z` tag triggers the GitHub Actions release workflow. The workflow validates the corresponding package version, checks, tests, builds and packs it, then attaches the `.tgz` to a GitHub Release.

Related ADRs:

- [ADR 0001](../adr/0001-registry-free-package-releases.md): immutable artifact policy.
- [ADR 0002](../adr/0002-dual-layer-provider-contract.md): package API boundary.
- [ADR 0003](../adr/0003-explicit-provider-execution.md): BYOK and fallback policy.
- [ADR 0004](../adr/0004-dual-format-helper-esm-pi-ai-subpath.md): module formats.
- [ADR 0005](../adr/0005-provider-reported-usage.md): usage and billing.
