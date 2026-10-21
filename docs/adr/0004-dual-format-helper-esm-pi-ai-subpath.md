# ADR 0004: Dual-format helper entry, ESM-only pi-ai subpath

- Status: Accepted
- Date: 2026-09-28
- Related: [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512), [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513), [DATA-4566](https://hk01-digital.atlassian.net/browse/DATA-4566), [DATA-4567](https://hk01-digital.atlassian.net/browse/DATA-4567)

## Context

The first consumer (`open-graph-single`) bundles its server as CommonJS with `--packages=external`, so it loads dependencies with `require()`. Later consumers, such as a usage-recording proxy, are ESM and use pi-ai directly. `@earendil-works/pi-ai` (0.87.1 at the time, 1.2.0 since 2026-10-16) is ESM-only: its package exports have only an `import` condition, so `require()` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

TypeScript 7 removed the JavaScript compiler API that tsup's declaration build (rollup-plugin-dts) depends on.

## Decision

- Each package's main entry contains the image helper, model catalogue, task lookups and errors. It does not import pi-ai, and it ships as both CommonJS (`.cjs` / `.d.cts`) and ESM (`.mjs` / `.d.mts`).
- The `/pi-ai` subpath contains the pi-ai factories and is exported for `import` only. Its CommonJS build is excluded from the package.
- `@earendil-works/pi-ai` is an exact, optional peer dependency (currently `1.2.0`). Consumers of the subpath share their own pi-ai instance; helper-only consumers do not install it.
- Type-checking uses TypeScript 7. tsdown builds JavaScript and declarations, using oxc isolated declarations, so every export carries an explicit type.

Amended 2026-10-16 ([DATA-4566](https://hk01-digital.atlassian.net/browse/DATA-4566)): the exact pi-ai peer moved from `0.87.1` to `1.2.0`, and the Context and the peer-dependency point now name both versions. pi-ai 1.2 is still ESM-only, so the decision stands unchanged: the `/pi-ai` subpath stays ESM-only and the peer stays exact and optional.

Amended 2026-10-16 ([DATA-4567](https://hk01-digital.atlassian.net/browse/DATA-4567)): `@hk01/pi-ai-extra-chat-kit` ([ADR 0008](0008-chat-kit-package.md)) is an exception to the first three points. Its only entry imports pi-ai and ships as ESM only (`.mjs` / `.d.mts`), with no CommonJS build and no `/pi-ai` subpath, and pi-ai is a required exact peer (`1.2.0`), not an optional one. The kit exists only to drive pi-ai, which is ESM-only, so a main entry without pi-ai would have nothing to hold, and a CommonJS build could not load it. Like the `/pi-ai` subpath, the kit needs ESM or a dynamic `import()`; its release smoke test checks that `require()` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The provider packages and the image kit keep the decision unchanged.

Amended 2026-10-21 ([DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583)): `@hk01/pi-ai-extra-openrouter` ([ADR 0009](0009-chat-kit-contract-aligned-with-pi-ai.md)) is a second exception, to the first and third points. It has no main entry, only the ESM-only `/pi-ai` subpath, and pi-ai is a required exact peer (`1.2.0`). The package is only a pi-ai provider, since pi-ai already serves OpenRouter's images, so a main entry would have nothing to hold. Keeping the `/pi-ai` path gives every provider package the same import path. Chat kit's exception stands, and its provider-package peers become optional. The other provider packages keep the decision unchanged.

## Consequences

CommonJS servers adopt the helpers without changing their build. Using the pi-ai factories requires ESM (or a dynamic `import()`), just as pi-ai does.

Both formats can be loaded in one process. Errors are therefore checked with `isPiAiExtraError()`, which uses a brand property, not `instanceof`.
