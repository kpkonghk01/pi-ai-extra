# Domain glossary

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

## Fallback

Automatically changing provider, model, or file-storage provider after a request fails. Fallback is prohibited: the selected provider/model either succeeds or reports its own failure.

## Release artifact

A versioned `.tgz` package attached to a GitHub Release. It is the consumer-installable delivery unit while no npm registry is used.
