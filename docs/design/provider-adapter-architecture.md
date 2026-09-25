# Provider adapter architecture

## Purpose

This repository centralises KIE and ToAPIs integrations that would otherwise be independently implemented by multiple AI Studio applications. The detailed delivery and acceptance criteria live in [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513); downstream application adoption lives in [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512).

## Package map

```text
pi-ai-extra/
├── packages/
│   ├── internal/       private shared transport, task, and image helpers
│   ├── kie/            @hk01/pi-ai-extra-kie
│   └── toapis/         @hk01/pi-ai-extra-toapis
├── referenc-docs/      provider source contracts
└── .github/workflows/  tag-to-GitHub-Release automation
```

`internal` is only a workspace/build dependency. The KIE and ToAPIs build outputs bundle shared runtime code, so each public `.tgz` installs independently.

## Consumer boundary

A consumer app imports adapters on its server only. It reads a selected provider key from its own secret configuration and supplies it explicitly to the adapter factory/helper.

```text
Consumer server secret
        │
        ▼
KIE or ToAPIs adapter package
        │
        ├─ pi-ai provider factory for Responses/Messages chat and Models
        └─ validated image operation for upload → task → final image
        │
        ▼
Selected provider and model
```

The browser does not receive provider keys and does not import the adapter package.

## Image operation flow

1. The consumer chooses a single provider and model operation.
2. The helper validates that operation's documented prompt, ratio, resolution, background, output, and reference-image limits.
3. Inline reference images become provider-native public URLs through the selected provider only.
4. The helper submits the provider task and polls only the selected provider until success, failure, timeout, or cancellation.
5. The helper validates final image URLs and normalises final output for the consumer and pi-ai image result contract.

There is no provider fallback, model fallback, cross-provider upload fallback, or silent input truncation.

## Initial support matrix

| Adapter | Initial image operations | Initial chat protocols |
| --- | --- | --- |
| KIE | Grok Imagine Image 2.0 text/edit; GPT Image 2 text/image; Nano Banana 2 text/image | OpenAI Responses GPT; Anthropic Messages Claude |
| ToAPIs | Gemini 2.5 Flash Image; GPT Image 2; GPT Image 2.5 Flare/Sunburst; Seedream 5.0 Pro | OpenAI Responses Codex; Anthropic Messages Claude |

Wokey is intentionally excluded from the first release because of the observed image-generation failure rate.

## Source documents

Use the committed provider files in [`referenc-docs/`](../../referenc-docs/) before adding or changing any model operation. The KIE index links to model-specific documents; a model is not considered supported merely because it appears in that index.

## Release path

A `kie-vX.Y.Z` or `toapis-vX.Y.Z` tag triggers the GitHub Actions release workflow. The workflow validates the corresponding package version, builds and packs it, then attaches the `.tgz` to a GitHub Release.

See [ADR 0001](../adr/0001-registry-free-package-releases.md) for the immutable artifact policy, [ADR 0002](../adr/0002-dual-layer-provider-contract.md) for the package API boundary, and [ADR 0003](../adr/0003-explicit-provider-execution.md) for BYOK and fallback policy.
