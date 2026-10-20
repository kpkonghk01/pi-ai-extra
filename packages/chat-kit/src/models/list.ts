import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRate } from "@hk01/pi-ai-extra-internal/rates";
import { untilAborted } from "../abort.ts";
import { errorText } from "../errors.ts";
import type { ChatModelInput } from "../types.ts";

/** A chat model a provider offers: the pi-ai model the turn runs on, its rate and what it reads. */
export interface ListedModel {
  readonly model: Model<Api>;
  /** The model's rate schedule; undefined when it has no rate. */
  readonly rate: ModelRate | undefined;
  /** What the model reads. pi-ai's `input` has no `file`, so this is the kit's own account. */
  readonly input: readonly ChatModelInput[];
}

/** A live list is fresh for 30 minutes; after that the next lookup or listing starts a refresh. */
export const MODEL_LIST_TTL_MS: number = 30 * 60_000;

/** After a failed refresh, the next attempt waits a minute, so a provider whose list is down is not asked on every turn. */
export const FAILED_REFRESH_RETRY_MS = 60_000;

/** One deadline for a whole list read: every request and page of it (KIE's two lists, Gemini's pages). */
export const LIST_READ_TIMEOUT_MS = 5_000;

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
  /** The list, by the refresh rules of `createModelList`. */
  read(): Promise<ModelListSnapshot>;
  /** The model with this id in the list `read()` returns: a turn resolves against the same list. */
  find(id: string): Promise<{ model: ListedModel | undefined; snapshot: ModelListSnapshot }>;
}

export interface ModelListSource {
  /** The installed catalogue or package definitions: the list until a live one has been read. */
  installed: readonly ListedModel[];
  /**
   * Reads the provider's live list. It throws when the list cannot be read or lists no model.
   * `signal` aborts at the read's deadline (`LIST_READ_TIMEOUT_MS`).
   */
  fetchLive(signal: AbortSignal): Promise<readonly ListedModel[]>;
  now(): number;
}

/**
 * The refresh rules:
 *
 * - **Cold** (no live list has been read yet): a lookup or listing reads the live list and waits
 *   for it, up to `LIST_READ_TIMEOUT_MS` (5 s). If the read fails, it answers from the installed
 *   catalogue or definitions.
 * - **Stale** (the last good live list is 30 minutes old): a lookup or listing answers from that
 *   list at once and starts a refresh in the background; the lookups after it see the new list.
 *   No turn waits for it. So a model the provider has dropped can still be resolved, and sent,
 *   until that refresh lands; the provider then answers with its own error.
 * - A failed refresh keeps the last good list, or the installed one when no live list was ever
 *   read, and the next attempt waits a minute (`FAILED_REFRESH_RETRY_MS`).
 * - Concurrent callers share one refresh. It has its own deadline and never takes a caller's
 *   signal, so a caller that stops waiting does not cancel it for the others.
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

  /** One live read under one deadline. It never rejects: a failure is recorded instead. */
  const readLive = async (): Promise<void> => {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException(`the model list was not read within ${LIST_READ_TIMEOUT_MS / 1000} s`, "TimeoutError")),
      LIST_READ_TIMEOUT_MS,
    );
    try {
      // The race also ends a read whose fetch ignores the signal.
      const models = await untilAborted(source.fetchLive(deadline.signal), deadline.signal, () => deadline.signal.reason);
      live = { models, fetchedAt: source.now() };
      failure = undefined;
    } catch (error) {
      failure = { error: errorText(error), at: source.now() };
    } finally {
      clearTimeout(timer);
    }
  };

  const refresh = (): Promise<void> => {
    // `finally` runs as a later microtask, so `inFlight` is cleared only after it is assigned, even
    // when `fetchLive` throws synchronously and `readLive()` has already settled.
    inFlight ??= readLive().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const read = async (): Promise<ModelListSnapshot> => {
    if (due()) {
      const refreshing = refresh();
      if (live === undefined) await refreshing;
    }
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
