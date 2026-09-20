import type { NaradReducer } from '../reducer/index.js';
import { logNaradDebug, logNaradError } from '../debug.js';
import { NaradClientError, redactForPublicError } from '../security.js';
import type { NaradProfileId, NaradTransport, AttachCoordinatorSnapshot } from '../types.js';
import { DEFAULT_NARAD_LIMITS } from '../types.js';

export interface AttachCoordinatorOptions {
  readonly sessionId: string;
  readonly claimedProfiles?: readonly NaradProfileId[];
  readonly historyPageSize?: number;
  readonly limits?: typeof DEFAULT_NARAD_LIMITS;
}

/**
 * Session attach owner: history fill → live apply.
 *
 * Model:
 * - Authority is ordered by sessionSequence.
 * - Live applies records in order.
 * - History is only used at attach and when apply() reports a sequence gap.
 * - requestRecovery is fill-from-cursor + drain (not a parallel product pipeline).
 */
export interface AttachCoordinator {
  attach(): Promise<void>;
  /** Fill history from reducer cursor, then drain buffered live. */
  requestRecovery(): Promise<void>;
  dispose(): void;
  getSnapshot(): AttachCoordinatorSnapshot;
  subscribe(listener: () => void): () => void;
}

type AttachPhase = 'idle' | 'attaching' | 'backfilling' | 'draining' | 'live';

export function negotiateActiveProfiles(
  advertised: readonly NaradProfileId[],
  claimed?: readonly NaradProfileId[],
): NaradProfileId[] {
  if (!claimed || claimed.length === 0) {
    return [...advertised];
  }
  const advertisedSet = new Set(advertised);
  return claimed.filter((profile) => advertisedSet.has(profile));
}

export function createAttachCoordinator(
  transport: NaradTransport,
  reducer: NaradReducer,
  options: AttachCoordinatorOptions,
): AttachCoordinator {
  const limits = options.limits ?? DEFAULT_NARAD_LIMITS;
  const historyPageSize = options.historyPageSize ?? Math.min(100, limits.maxHistoryEvents);
  const maxPending = limits.maxPendingQueue;
  let attached = false;
  let phase: AttachPhase = 'idle';
  let liveSubscribed = false;
  let resyncRequired = false;
  let liveError: string | null = null;
  let pending: unknown[] = [];
  let abortController: AbortController | null = null;
  let disposed = false;
  let attaching = false;
  let recoveryChain: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function getSnapshot(): AttachCoordinatorSnapshot {
    return {
      attached,
      backfilling: phase === 'backfilling',
      live: phase === 'live',
      liveSubscribed,
      pendingCount: pending.length,
      resyncRequired: resyncRequired || reducer.getSnapshot().sessionGap,
      liveError,
    };
  }

  function shouldBufferLiveRecords(): boolean {
    return (
      attaching ||
      phase === 'backfilling' ||
      phase === 'draining' ||
      reducer.getSnapshot().sessionGap
    );
  }

  function enqueue(record: unknown): void {
    if (pending.length >= maxPending) {
      resyncRequired = true;
      liveError = 'Live buffer overflow requires resync.';
      logNaradError('coordinator', 'pending overflow', liveError, { pending: pending.length, maxPending });
      throw new NaradClientError('pending_overflow', liveError);
    }
    pending.push(record);
  }

  function shouldSkipBufferedHydrate(record: unknown, historyStartCursor: number): boolean {
    if (typeof record !== 'object' || record === null) {
      return false;
    }
    if ((record as { type?: unknown }).type !== 'messages.snapshot') {
      return false;
    }
    const coversThrough = (record as { coversThroughSessionSequence?: unknown }).coversThroughSessionSequence;
    return historyStartCursor === 0
      && typeof coversThrough === 'number'
      && reducer.getSnapshot().lastSessionSequence >= coversThrough;
  }

  function drainPending(historyStartCursor: number): boolean {
    while (pending.length > 0) {
      const next = pending.shift();
      if (!next) {
        continue;
      }
      if (shouldSkipBufferedHydrate(next, historyStartCursor)) {
        continue;
      }
      const result = reducer.apply(next);
      if (result.gap) {
        pending.unshift(next);
        return false;
      }
    }
    return true;
  }

  async function fillHistoryFrom(cursor: number): Promise<void> {
    let pageCursor = cursor;
    while (!disposed) {
      const page = await transport.fetchHistory(options.sessionId, pageCursor, historyPageSize);
      if (page.events.length > limits.maxHistoryEvents) {
        resyncRequired = true;
        throw new NaradClientError('history_limit_exceeded', 'History page exceeds configured limit.');
      }
      logNaradDebug('coordinator', 'history page', {
        sessionId: options.sessionId,
        cursor: pageCursor,
        eventCount: page.events.length,
        nextSessionSequence: page.nextSessionSequence,
      });
      for (const record of page.events) {
        reducer.apply(record);
      }
      if (page.nextSessionSequence === null) {
        return;
      }
      pageCursor = page.nextSessionSequence;
    }
  }

  function applyLiveRecord(record: unknown, afterSessionSequence: number): number {
    const result = reducer.apply(record);
    const nextCursor = Math.max(afterSessionSequence, reducer.getSnapshot().lastSessionSequence);
    if (result.gap) {
      // Sequence hole: buffer this frame and fill authority; do not invent state.
      try {
        enqueue(record);
      } catch {
        // overflow sets liveError
      }
      void queueCatchUp('live_gap');
    }
    return nextCursor;
  }

  function throwIfLiveFault(preferredCode: 'pending_overflow' | 'live_subscribe_failed'): void {
    if (!liveError) {
      return;
    }
    const code = liveError.includes('overflow') ? 'pending_overflow' : preferredCode;
    throw new NaradClientError(code, liveError);
  }

  async function awaitLiveConsumerSettled(historyStartCursor: number): Promise<void> {
    for (let pass = 0; pass < 32; pass += 1) {
      drainPending(historyStartCursor);
      if (liveError || reducer.getSnapshot().sessionGap) {
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }

  function isFatalLiveFault(error: unknown): boolean {
    const redacted = redactForPublicError(error);
    return (
      redacted.code === 'invalid_frame' ||
      redacted.code === 'unauthorized' ||
      redacted.code === 'frame_id_mismatch' ||
      redacted.code === 'pending_overflow'
    );
  }

  /**
   * Fill authority from cursor, clear gap latch, drain live buffer.
   * Idempotent; safe after attach or after a live gap.
   */
  async function catchUpFromGap(reason: string): Promise<void> {
    if (disposed || !attached) {
      return;
    }
    const previous = phase;
    phase = 'backfilling';
    notifyListeners();

    if (reducer.getSnapshot().sessionGap) {
      reducer.clearSessionGap();
    }
    reducer.clearResyncRequired();

    const fillFrom = reducer.getSnapshot().lastSessionSequence;
    logNaradDebug('coordinator', 'catch-up', {
      reason,
      sessionId: options.sessionId,
      fillFrom,
      previousPhase: previous,
    });

    try {
      await fillHistoryFrom(fillFrom);
    } catch (error) {
      liveError = redactForPublicError(error).message;
      logNaradError('coordinator', 'history fill failed', error, { fillFrom });
      phase = 'live';
      notifyListeners();
      return;
    }

    phase = 'draining';
    notifyListeners();
    const drained = drainPending(reducer.getSnapshot().lastSessionSequence);

    resyncRequired = !drained || reducer.getSnapshot().sessionGap;
    phase = 'live';
    logNaradDebug('coordinator', 'catch-up complete', {
      reason,
      lastSessionSequence: reducer.getSnapshot().lastSessionSequence,
      pendingCount: pending.length,
      resyncRequired,
    });
    notifyListeners();
  }

  function queueCatchUp(reason: string): Promise<void> {
    recoveryChain = recoveryChain
      .catch(() => undefined)
      .then(() => catchUpFromGap(reason));
    return recoveryChain;
  }

  function startLiveConsumer(initialAfterSessionSequence: number): void {
    abortController = new AbortController();
    void (async () => {
      let afterSessionSequence = initialAfterSessionSequence;
      try {
        while (!disposed && !abortController?.signal.aborted) {
          try {
            const liveStream = transport.subscribeLive(
              options.sessionId,
              afterSessionSequence,
              abortController?.signal,
            );
            liveSubscribed = true;
            notifyListeners();
            for await (const record of liveStream) {
              if (disposed) {
                return;
              }
              if (shouldBufferLiveRecords()) {
                try {
                  enqueue(record);
                } catch (error) {
                  if (!disposed) {
                    liveError = redactForPublicError(error).message;
                    logNaradError('coordinator', 'live enqueue failed', error);
                    notifyListeners();
                  }
                  return;
                }
              } else {
                afterSessionSequence = applyLiveRecord(record, afterSessionSequence);
              }
              notifyListeners();
            }
            if (disposed || abortController?.signal.aborted) {
              return;
            }
            // Clean SSE EOF: transport may have ended this generator. Fill the
            // journal hole before opening a new tail so user turns are not lost.
            afterSessionSequence = Math.max(
              afterSessionSequence,
              reducer.getSnapshot().lastSessionSequence,
            );
            logNaradDebug('coordinator', 'live stream ended; catching up', {
              sessionId: options.sessionId,
              afterSessionSequence,
            });
            await queueCatchUp('live_eof');
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 250);
            });
          } catch (error) {
            if (disposed || abortController?.signal.aborted) {
              return;
            }
            if (isFatalLiveFault(error)) {
              liveError = redactForPublicError(error).message;
              logNaradError('coordinator', 'fatal live fault', error, { afterSessionSequence });
              notifyListeners();
              return;
            }
            logNaradError('coordinator', 'live stream reconnecting', error, { afterSessionSequence });
            afterSessionSequence = Math.max(afterSessionSequence, reducer.getSnapshot().lastSessionSequence);
            await queueCatchUp('live_reconnect');
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 250);
            });
            if (disposed || abortController?.signal.aborted) {
              return;
            }
          }
        }
      } finally {
        if (phase === 'live') {
          phase = 'idle';
        }
        notifyListeners();
      }
    })();
  }

  return {
    async attach(): Promise<void> {
      if (disposed) {
        throw new Error('Coordinator disposed.');
      }
      logNaradDebug('coordinator', 'attach start', {
        sessionId: options.sessionId,
        localCursor: reducer.getSnapshot().lastSessionSequence,
      });
      phase = 'attaching';
      attaching = true;
      try {
        const localCursor = reducer.getSnapshot().lastSessionSequence;
        const attachResult = await transport.attach(options.sessionId, {
          claimedProfiles: options.claimedProfiles,
        });
        attached = true;
        const activeProfiles = negotiateActiveProfiles(
          attachResult.capabilities.activeProfiles,
          options.claimedProfiles,
        );
        reducer.setActiveProfiles(activeProfiles);
        logNaradDebug('coordinator', 'attach negotiated', {
          sessionId: options.sessionId,
          boundarySessionSequence: attachResult.boundarySessionSequence,
          activeProfiles,
          currentSessionSequence: attachResult.capabilities.currentSessionSequence,
        });

        phase = 'backfilling';
        startLiveConsumer(attachResult.boundarySessionSequence);

        await new Promise<void>((resolve) => {
          const waitForLive = (): void => {
            if (liveSubscribed || liveError) {
              resolve();
              return;
            }
            setTimeout(waitForLive, 0);
          };
          waitForLive();
        });

        notifyListeners();
        throwIfLiveFault('live_subscribe_failed');

        await fillHistoryFrom(localCursor);

        phase = 'draining';
        notifyListeners();
        drainPending(localCursor);
        await Promise.resolve();
        drainPending(localCursor);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        while (pending.length > 0 && !reducer.getSnapshot().sessionGap) {
          if (!drainPending(localCursor)) {
            break;
          }
        }
        await awaitLiveConsumerSettled(localCursor);
        throwIfLiveFault('pending_overflow');

        if (reducer.getSnapshot().sessionGap) {
          await catchUpFromGap('attach_gap');
        } else {
          resyncRequired = false;
          phase = 'live';
        }

        logNaradDebug('coordinator', 'live', {
          sessionId: options.sessionId,
          lastSessionSequence: reducer.getSnapshot().lastSessionSequence,
        });
        notifyListeners();
      } finally {
        attaching = false;
        if (phase !== 'live') {
          phase = phase === 'backfilling' || phase === 'draining' ? 'live' : phase;
        }
        notifyListeners();
      }
    },

    async requestRecovery(): Promise<void> {
      if (disposed || !attached) {
        return;
      }
      await queueCatchUp('request');
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      disposed = true;
      abortController?.abort();
      transport.dispose();
      pending = [];
      attached = false;
      phase = 'idle';
      liveSubscribed = false;
      recoveryChain = Promise.resolve();
      listeners.clear();
    },

    getSnapshot,
  };
}

export function mergeLiveAndBackfill(
  reducer: NaradReducer,
  liveRecords: readonly unknown[],
  backfillRecords: readonly unknown[],
): void {
  for (const record of liveRecords) {
    reducer.apply(record);
  }
  for (const record of backfillRecords) {
    reducer.apply(record);
  }
}

export function shouldBufferUntilBackfillComplete(backfilling: boolean): boolean {
  return backfilling;
}
