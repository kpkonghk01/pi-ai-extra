# ADR 0001: Deliver adapter packages as GitHub Release artifacts

- Status: Accepted
- Date: 2026-09-25
- Related: [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513)

## Context

The project needs independently installable KIE and ToAPIs adapters, but has no npm registry. Consumer applications still need immutable, reproducible package versions and a simple rollback path.

A Git dependency that points to a package subdirectory installs source and may run its build process on each consumer. A single monorepo tarball would couple consumers to adapters they do not use. Publishing to an npm registry is not available in this phase.

## Decision

Publish one self-contained `.tgz` artifact per public adapter package through GitHub Releases:

- `@hk01/pi-ai-extra-kie` releases from `kie-vX.Y.Z`.
- `@hk01/pi-ai-extra-toapis` releases from `toapis-vX.Y.Z`.
- `@hk01/pi-ai-extra-google` releases from `google-vX.Y.Z` (added 2026-09-28 for Gemini image generation, which pi-ai does not provide).

Amended 2026-10-21 ([DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583)): `@hk01/pi-ai-extra-openrouter` releases from `openrouter-vX.Y.Z` ([ADR 0009](0009-chat-kit-contract-aligned-with-pi-ai.md)). The two kits, added after this list was written, release the same way: `@hk01/pi-ai-extra-image-kit` from `image-kit-vX.Y.Z` ([ADR 0006](0006-image-kit-package.md)) and `@hk01/pi-ai-extra-chat-kit` from `chat-kit-vX.Y.Z` ([ADR 0008](0008-chat-kit-package.md)).

GitHub Actions validates that the tag matches the package manifest version, checks, tests and builds the selected package, packs it, and attaches the artifact to the matching GitHub Release. The pnpm version comes from the root `packageManager` field.

Shared implementation is private workspace code and must be bundled into each public artifact. A consumer must never need to resolve an unpublished sibling workspace package.

## Consequences

Consumers pin a direct GitHub Release asset URL rather than a registry version. Upgrades and rollbacks are explicit URL/version changes.

Published artifact URLs become part of consumer deployments. Releases already used by a consumer must be retained; a correction is normally a new patch release, not a replacement of an existing asset.

Changing the `@hk01` scope after a release creates a new package identity. Existing release artifacts and consumers require a planned migration.
