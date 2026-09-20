import { logNaradApply } from '../debug.js';
import { redactForPublicError } from '../security.js';
import type { NaradLimits, NaradProfileId, NaradSessionSnapshot, ReducerApplyResult } from '../types.js';
import { DEFAULT_NARAD_LIMITS } from '../types.js';
import { classifyWireRecord } from '../wire.js';
import { validateAuthorityEvent, validateHydrateRecord } from '../validate/index.js';
import {
  applyAuthorityEventToState,
  applyHydrateRecordToState,
  applyWatchEventToState,
} from './apply.js';
import { SnapshotCache } from './snapshotCache.js';
import { createInitialReducerState, type ReducerInternalState } from './state.js';

export interface NaradReducer {
  getSnapshot(): NaradSessionSnapshot;
  apply(value: unknown): ReducerApplyResult;
  clearSessionGap(): void;
  clearResyncRequired(): void;
  setActiveProfiles(profiles: readonly NaradProfileId[]): void;
}

export interface CreateNaradReducerOptions {
  readonly sessionId: string;
  readonly activeProfiles?: readonly NaradProfileId[];
  readonly limits?: NaradLimits;
}

export function createNaradReducer(options: CreateNaradReducerOptions): NaradReducer {
  const limits = options.limits ?? DEFAULT_NARAD_LIMITS;
  let state: ReducerInternalState = createInitialReducerState(
    options.sessionId,
    options.activeProfiles ?? [],
  );
  const snapshotCache = new SnapshotCache();

  return {
    getSnapshot(): NaradSessionSnapshot {
      return snapshotCache.getSnapshot(state);
    },
    apply(value: unknown): ReducerApplyResult {
      try {
        const wireClass = classifyWireRecord(value);
        let result: ReducerApplyResult;
        if (wireClass === 'hydrate') {
          const record = validateHydrateRecord(value, limits, state.activeProfiles);
          result = applyHydrateRecordToState(state, record, limits);
        } else if (wireClass === 'watch') {
          const event = validateAuthorityEvent(value, limits, state.activeProfiles);
          result = applyWatchEventToState(state, event, limits);
        } else if (wireClass === 'authority') {
          const event = validateAuthorityEvent(value, limits, state.activeProfiles);
          result = applyAuthorityEventToState(state, event, limits);
        } else {
          result = {
            applied: false,
            duplicate: false,
            gap: false,
            resyncRequired: state.resyncRequired,
            error: 'Unsupported wire record for reducer.',
          };
        }
        logNaradApply(value, result);
        return result;
      } catch (error) {
        const redacted = redactForPublicError(error);
        state.lastError = redacted.message;
        state.version += 1;
        const result: ReducerApplyResult = {
          applied: false,
          duplicate: false,
          gap: false,
          resyncRequired: state.resyncRequired,
          error: redacted.message,
        };
        logNaradApply(value, result);
        return result;
      }
    },
    clearSessionGap(): void {
      state.sessionGap = false;
      state.version += 1;
    },
    clearResyncRequired(): void {
      state.resyncRequired = false;
      state.version += 1;
    },
    setActiveProfiles(profiles: readonly NaradProfileId[]): void {
      state.activeProfiles = [...profiles];
      state.version += 1;
    },
  };
}

export function replayJsonlReducer(
  reducer: NaradReducer,
  lines: readonly string[],
): { applied: number; duplicates: number; gaps: number; errors: string[] } {
  let applied = 0;
  let duplicates = 0;
  let gaps = 0;
  const errors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const value = JSON.parse(trimmed) as unknown;
    const wireClass = classifyWireRecord(value);
    if (wireClass === 'control') {
      continue;
    }
    const result = reducer.apply(value);
    if (result.applied) applied += 1;
    if (result.duplicate) duplicates += 1;
    if (result.gap) gaps += 1;
    if (result.error) errors.push(result.error);
  }
  return { applied, duplicates, gaps, errors };
}
