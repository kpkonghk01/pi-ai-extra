import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRate } from "@hk01/pi-ai-extra-internal/rates";
import type { ChatModelInput } from "../types.ts";
import { listErrorText } from "./http.ts";

/** A chat model a provider offers: the pi-ai model the turn runs on, its rate and what it reads. */
export interface ListedModel {
  readonly model: Model<Api>;
  /** The model's rate schedule; undefined when it has no rate. */
  readonly rate: ModelRate | undefined;
  /** What the model reads. pi-ai's `input` has no `file`, so this is the kit's own account. */
  readonly input: readonly ChatModelInput[];
}

/** A live list is fresh for 30 minutes; after that the next lookup or listing reads it again first. */
export const MODEL_LIST_TTL_MS: number = 30 * 60_000;

/** After a failed refresh, the next attempt waits a minute, so a provider whose list is down is not asked on every turn. */
export const FAILED_REFRESH_RETRY_MS = 60_000;

/** The list a provider's turns resolve against, and where it came from. */
export interface ModelListSnapshot {
  models: readonly ListedModel[];
  /** `live`: the provider's own list (possibly the last good one); `installed`: no live list has been read yet. */
  source: "live" | "installed";
  /** When the live list was read (epoch ms). */
  fetchedAt?: number | undefined;
  /** Why the latest refresh failed; cleared by the next one that succeeds. */
  refreshError?: string | undefined;
}

export interface ModelList {
  /**
   * The list, refreshed first when it is due: when no live list has been read yet, or the live
   * list is 30 minutes old, unless a refresh failed less than a minute ago.
   */
  read(): Promise<ModelListSnapshot>;
  /** The model with this id in the list `read()` returns: a turn resolves against the same, refreshed list. */
  find(id: string): Promise<{ model: ListedModel | undefined; snapshot: ModelListSnapshot }>;
}

export interface ModelListSource {
  /** The installed catalogue or package definitions: the list until a live one has been read. */
  installed: readonly ListedModel[];
  /** Reads the provider's live list. It throws when the list cannot be read or lists no model. */
  fetchLive(signal: AbortSignal): Promise<readonly ListedModel[]>;
  now(): number;
}

/**
 * The refresh rules: the first lookup or listing reads the live list, and a live list is fresh for
 * 30 minutes, after which the next lookup or listing reads it again before it answers. A failed
 * refresh keeps the last good list, or the installed one when no live list was ever read, and is
 * retried after a minute. Concurrent callers share one refresh. A refresh never takes a caller's
 * signal: a caller that stops waiting does not cancel it for the others.
 */
export function createModelList(source: ModelListSource): ModelList {
  let live: { models: readonly ListedModel[]; fetchedAt: number } | undefined;
  let failure: { error: string; at: number } | undefined;
  let inFlight: Promise<void> | undefined;

  const snapshot = (): ModelListSnapshot =>
    live === undefined
      ? { models: source.installed, source: "installed", ...(failure ? { refreshError: failure.error } : {}) }
      : { models: live.models, source: "live", fetchedAt: live.fetchedAt, ...(failure ? { refreshError: failure.error } : {}) };

  const due = (): boolean => {
    const now = source.now();
    if (failure !== undefined && now - failure.at < FAILED_REFRESH_RETRY_MS) return false;
    return live === undefined || now - live.fetchedAt >= MODEL_LIST_TTL_MS;
  };

  const refresh = (): Promise<void> => {
    inFlight ??= (async () => {
      try {
        const models = await source.fetchLive(new AbortController().signal);
        live = { models, fetchedAt: source.now() };
        failure = undefined;
      } catch (error) {
        failure = { error: listErrorText(error), at: source.now() };
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const read = async (): Promise<ModelListSnapshot> => {
    if (due()) await refresh();
    return snapshot();
  };

  return {
    read,
    async find(id) {
      const list = await read();
      return { model: list.models.find((listed) => listed.model.id === id), snapshot: list };
    },
  };
}
