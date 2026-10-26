import { createModels, type Api, type AuthContext, type Model, type MutableModels } from "@earendil-works/pi-ai";
import type { ChatProvider, ChatProviderTraits } from "@hk01/pi-ai-extra-internal/pi-ai";
import { createModelList, type ModelList } from "./models/list.ts";

/** An auth context with no environment and no files, so pi-ai never finds an ambient key. */
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/** One registered chat provider, under its pi-ai id. */
export interface RegisteredProvider {
  readonly id: string;
  readonly traits: ChatProviderTraits;
  /** The offered models (`traits.offers`): live, or the installed ones while no live list has been read. */
  readonly models: ModelList;
}

/** Every registered provider, by pi-ai id, in registration order, and the pi-ai `Models` they run in. */
export interface ProviderRegistry {
  readonly providers: ReadonlyMap<string, RegisteredProvider>;
  readonly models: MutableModels;
}

export interface RegistryOptions {
  /** The clock for list freshness; tests replace it. */
  now?: (() => number) | undefined;
}

/**
 * Registers each chat provider by its pi-ai id in one pi-ai `Models` collection, created with an
 * empty auth context, so pi-ai never reads `process.env`: each provider resolves only the key its
 * factory bound. pi-ai's `setProvider()` silently replaces a provider with the same id, so a
 * duplicate id throws a `TypeError` instead. Each provider's offered models are read through
 * pi-ai's `Models.refresh()`, which runs the provider's `refreshModels`.
 */
export function createProviderRegistry(providers: readonly ChatProvider[], options: RegistryOptions = {}): ProviderRegistry {
  const now = options.now ?? Date.now;
  const models = createModels({ authContext: NO_AMBIENT_AUTH });
  const registered = new Map<string, RegisteredProvider>();
  for (const provider of providers) {
    if (registered.has(provider.id)) {
      throw new TypeError(
        `chat-kit: two providers have the id ${JSON.stringify(provider.id)}; a kit holds one provider per id, so a second key for the same provider needs its own kit.`,
      );
    }
    models.setProvider(provider);
    const traits = provider.chatKit;
    const offered = (list: readonly Model<Api>[]) => list.filter((model) => traits.offers(model));
    registered.set(provider.id, {
      id: provider.id,
      traits,
      models: createModelList({
        installed: offered(provider.getModels()),
        now,
        fetchLive:
          provider.refreshModels === undefined
            ? undefined
            : async (signal) => {
                const result = await models.refresh({ providers: [provider.id], force: true, signal });
                const error = result.errors.get(provider.id);
                if (error !== undefined) throw error;
                if (result.aborted) throw signal.reason;
                const live = offered(provider.getModels());
                if (live.length === 0) throw new Error("the live model list offers no chat model");
                return live;
              },
      }),
    });
  }
  return { providers: registered, models };
}

/**
 * Throws a `TypeError` unless `value` looks like a chat provider: a pi-ai `Provider` with an id,
 * `getModels` and `streamSimple`, and the chat kit's traits under `chatKit`.
 */
export function assertChatProvider(value: unknown, label: string): asserts value is ChatProvider {
  const problem = chatProviderProblem(value);
  if (problem !== undefined) throw new TypeError(`chat-kit: ${label} ${problem}`);
}

function chatProviderProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "is not a provider object.";
  const provider = value as Record<string, unknown>;
  if (typeof provider.id !== "string" || !provider.id) return "has no pi-ai provider id.";
  if (typeof provider.getModels !== "function" || typeof provider.streamSimple !== "function") return "is not a pi-ai provider.";
  const traits = provider.chatKit;
  if (typeof traits !== "object" || traits === null) {
    return `(${JSON.stringify(provider.id)}) has no chatKit traits: create it with a provider package's factory that returns a chat provider (google >=0.6.0, openrouter >=0.1.0, kie and toapis >=0.5.0).`;
  }
  const members = traits as Record<string, unknown>;
  const takes = members.takes;
  const complete =
    typeof takes === "object" &&
    takes !== null &&
    ["fileDocuments", "tools", "nativeStructuredOutput"].every((key) => typeof (takes as Record<string, unknown>)[key] === "boolean") &&
    ["offers", "describe", "reportedCostUsd"].every((key) => typeof members[key] === "function") &&
    typeof members.estimatesCost === "boolean";
  return complete ? undefined : `(${JSON.stringify(provider.id)}) has incomplete chatKit traits.`;
}
