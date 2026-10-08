# ADR 0007: Derive consumer model options from provider catalogues

- Status: Accepted
- Date: 2026-09-25
- Related: [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512), [DATA-4514](https://hk01-digital.atlassian.net/browse/DATA-4514), [DATA-4515](https://hk01-digital.atlassian.net/browse/DATA-4515)

## Context

Every AI Studio app currently copies a complete model allowlist. A provider package release can add a model, but no consumer receives it until each app edits its local registry. This duplication caused Auto OG and InfoCard to add Nano Banana 2.1 outside the provider package: Auto OG copied catalogue metadata and made a direct Google request; InfoCard patched installed package files after install.

Model suitability is still app-specific. Auto OG collage and edit prompts exceed Grok Imagine 2.0's 8,000-character limit, while other apps may use that family. Image model operations can also form one user-facing family, such as separate text-to-image and image-to-image operations.

## Decision

`@hk01/pi-ai-extra-image-kit` 0.2.0 will replace its static app model allowlist with a catalogue policy.

- Provider catalogues declare each operation's `familyId`, `familyName`, and `operationRole` (`unified`, `text-to-image`, or `image-to-image`). Image-kit groups family operations into one selectable model and chooses its operation from whether the request has reference images.
- An app starts with every model family supplied by its installed Google, KIE, and ToAPIs packages. A generated app model ID is the canonical `provider:familyId` key.
- An app policy has a default overlay and server-owned tool scopes. A scope adds canonical family exclusions to the default policy; it cannot re-include a default-excluded family.
- Routes fix their own scope. Browser requests may ask for the matching scope's model list, but cannot select a broader generation scope through their request body.
- The selector order is Google, ToAPIs, then KIE; models within a provider retain provider catalogue declaration order.
- App overrides in image-kit are limited to presentation: label, description, verified price, and mask-editing guidance. Prompt policy, such as Auto OG's prompt profile, stays in app code keyed by canonical family key. Newly discovered families default to catalogue name/notes, `price: null`, `maskEditing: reference-only`, and Auto OG's `default` prompt profile.
- A policy key that no installed catalogue declares is rejected when the image client is created, so a stale exclusion or override cannot silently stop applying.
- Known dynamic incompatibility remains runtime validation and is visible through the selector issue hint or ErrorPanel. Only permanent tool incompatibility belongs in a scope exclude list.

The first policies are:

```text
Auto OG collage/edit: exclude family kie:grok-imagine-image-2-0
InfoCard og/infocard/possession/batch/editor: no exclusions
open-graph-single generate/edit: no exclusions
```

## Considered options

- Keep one static allowlist in each app: rejected. New provider models require repeated app migrations and lead to consumer-owned provider transport workarounds.
- One global model policy for each app: rejected. Tools have different prompt length, reference, and editing constraints.
- Allow scopes to re-include a default-excluded family: rejected. It obscures effective policy and makes global exclusions unreliable.
- Infer text/edit pairs from model IDs: rejected. Naming conventions are not a provider contract.
- Keep image-kit 0.1 static mode beside policy mode: rejected. The two ownership models would require permanently divergent APIs, tests, and documentation. Existing apps remain pinned to 0.1 until migrated.

## Consequences

- Consumer apps perform one breaking migration to image-kit 0.2.0, then receive new non-excluded model families by upgrading the relevant provider package URL.
- A provider catalogue change must declare family metadata and have grouping regression coverage.
- An app cannot show a verified cost or precise mask support for an unknown future model without an explicit override.
- When a provider release drops a family, an app whose policy names it fails at startup until the stale key is removed.
- Auto OG and InfoCard remove their Nano Banana 2.1 local metadata, package patching, and direct Google transport. The Google package remains the sole owner of Nano Banana 2.1 transport.
