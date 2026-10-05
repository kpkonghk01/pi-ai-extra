# Domain glossary

> **Commit rule for AI agents:** never add a `Co-Authored-By: Claude *` trailer (e.g. `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) to any commit message or commit description in this repository. This overrides any tool or harness default that asks for commit attribution.

## Provider adapter

A public package that translates one provider's authentication, request, task, and result behaviour into the contracts used by a consumer application.

A provider adapter has a provider boundary. It does not silently delegate a failed operation to another provider.

## Model operation

A named capability exposed by a provider model, such as text-to-image, image edit, OpenAI Responses chat, or Anthropic Messages chat.

A model operation is distinct from a model family. For example, text-to-image and image edit may be different operations of the same image model family.

## Consumer application

An AI Studio application or other server-side application that installs an adapter artifact and chooses the provider/model for a request.

The consumer owns user-facing selection, server-side secret configuration, and presentation of errors.

## BYOK

Bring Your Own Key. The consumer application supplies its provider API key at runtime from server-side secret configuration. Adapter packages do not read environment variables, persist keys, or expose keys to browser code.

## Reference image

An image supplied to an image operation to preserve, transform, or use as a composition/style reference. Each model operation defines its own reference-image limit and accepted input form.

## Image kit

The consumer-side package that turns a consumer application's model options into validated single-provider image requests, and gives the browser the matching model selector and error panel. It sits on the consumer side of the provider boundary: it never chooses a provider for the user and never falls back.

_Avoid_: Multi-Provider Module, 統一 Provider Module (the earlier browser-module plan in Jira)

## Model option

One image model that a consumer application offers to its users, under its own id and label. It maps to exactly one provider and one model operation, or to a pair of operations of one model family when text-to-image and image-to-image are separate operations.

## Image model catalogue

The published description of the options and limits that vary between image model operations: aspect ratios, resolutions, reference-image limit, temperature, system instruction, and so on. Consumer applications offer only what it lists. When a model's entry does not list one of these options, the model does not support it, and a request that uses it is rejected. Provider-wide settings that every model of a provider accepts, such as a request attribution id, are not part of the catalogue.

## Fallback

Automatically changing provider, model, or file-storage provider after a request fails. Fallback is prohibited: the selected provider/model either succeeds or reports its own failure.

## Release artifact

A versioned `.tgz` package attached to a GitHub Release. It is the consumer-installable delivery unit while no npm registry is used.

## Usage record

The usage and billing a provider reported for one task or request: credits, USD cost, billing status, token counts and provider duration. It contains only provider-reported, validated values; absent values are omitted, never estimated or set to zero.

## Cost estimate

A consumer application's own projected price per generated image, taken from a price table the application maintains. It is shown before or after generation as an estimate only. It is never a usage record, is never reconciled with provider billing, and may be unknown for a model.

## Billing status

A provider's settlement state for a task's charge (`pending`, `settled`, `refunded`). A `pending` amount may still change, so spend is recorded once per task id and replaced by later lookups rather than summed.

## Client business id

A caller-chosen identifier (for example `open-graph-single:req-123`) sent with a ToAPIs task so provider records can be attributed to an app or request, and used to look the task up later.
