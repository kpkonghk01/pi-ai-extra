# ADR 0004: Dual-format helper entry, ESM-only pi-ai subpath

- Status: Accepted
- Date: 2026-09-28
- Related: [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512), [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513)

## Context

The first consumer (`open-graph-single`) bundles its server as CommonJS with `--packages=external`, so it loads dependencies with `require()`. Later consumers, such as a usage-recording proxy, are ESM and use pi-ai directly. `@earendil-works/pi-ai@0.87.1` is ESM-only: its package exports have only an `import` condition, so `require()` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

TypeScript 7 removed the JavaScript compiler API that tsup's declaration build (rollup-plugin-dts) depends on.

## Decision

- Each package's main entry contains the image helper, model catalogue, task lookups and errors. It does not import pi-ai, and it ships as both CommonJS (`.cjs` / `.d.cts`) and ESM (`.mjs` / `.d.mts`).
- The `/pi-ai` subpath contains the pi-ai factories and is exported for `import` only. Its CommonJS build is excluded from the package.
- `@earendil-works/pi-ai@0.87.1` is an exact, optional peer dependency. Consumers of the subpath share their own pi-ai instance; helper-only consumers do not install it.
- Type-checking uses TypeScript 7. tsdown builds JavaScript and declarations, using oxc isolated declarations, so every export carries an explicit type.

## Consequences

CommonJS servers adopt the helpers without changing their build. Using the pi-ai factories requires ESM (or a dynamic `import()`), just as pi-ai does.

Both formats can be loaded in one process. Errors are therefore checked with `isPiAiExtraError()`, which uses a brand property, not `instanceof`.
