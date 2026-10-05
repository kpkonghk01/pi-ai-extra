# ADR 0006: Ship the consumer-side image client as a package

- Status: Accepted
- Date: 2026-10-06
- Related: [DATA-4515](https://hk01-digital.atlassian.net/browse/DATA-4515), [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512), [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513)

## Context

Every AI Studio app migrated to the provider packages needs the same consumer code: its model list merged with the package catalogues, request validation, aspect ratio and resolution choice, a keep-alive stream for long tasks, a browser reader, a model selector and an error panel. The auto-og migration carried about 1,000 lines of app-local copies, which Gemini had to retype from the prompt, and three more apps follow InfoCard.

## Decision

Publish that code as `@hk01/pi-ai-extra-image-kit`, released like the provider packages (a GitHub Release `.tgz` per `image-kit-vX.Y.Z` tag).

- Unlike a provider adapter, it spans providers and has browser entries (`/browser`, `/react`). Only `/server` imports the adapters, so browser bundles never contain provider code or keys.
- The adapters and React are peer dependencies, so an app installs one copy of each and upgrades them by URL.
- It keeps ADR 0003's rules: one selected provider/model per request, no fallback, images never dropped. The app passes its environment explicitly (`env: process.env`); the kit never reads it itself.
- App-specific choices (the offered models, prices, secret names, reference conversion) stay in the app's config.

## Considered options

- App-local copies, as in auto-og: rejected. Each copy drifts, and about 1,000 lines per app have to be pasted through Gemini.
- One shared folder uploaded unchanged into each app: rejected. There is no versioning, and four or more files must be uploaded by hand per app.

## Consequences

- A kit change needs its own release and an app URL change.
- The peer ranges (`<1.0.0`) tie kit releases to the adapters' 0.x line.
- The kit's own UI uses inline styles, because Tailwind does not scan `node_modules`.
- open-graph-single and auto-og keep their app-local code until they are migrated to the kit.
