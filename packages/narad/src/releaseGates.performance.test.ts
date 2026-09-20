import { describe, expect, it } from 'vitest';
import { createNaradReducer } from './reducer/index.js';
import { commitEventFingerprint } from './reducer/dedup.js';
import { validateWireRecord } from './validate/index.js';
import { NARAD_PROFILE_IDS, DEFAULT_NARAD_LIMITS } from './types.js';
import {
  RELEASE_GATE_CORPUS,
  buildSteadyStateCorpus,
  loadAuthorityReplayCorpus,
  loadGraphProgressCorpus,
  measureMedianMs,
  progressEvent,
  runStartedEvent,
} from './test/releaseGatesCorpus.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

/** Generous machine-independent budgets; regressions >2x baseline fail. */
export const RELEASE_GATE_BUDGETS = {
  steadyStateParseValidateReduceMs: 4_000,
  largeAuthorityReplayMs: 6_000,
  gapBackfillMs: 2_000,
  graphProgressReplayMs: 1_500,
  dedupMapMaxEntries: DEFAULT_NARAD_LIMITS.maxHistoryEvents,
} as const;

function warmUp(): void {
  const reducer = createNaradReducer({ sessionId: 'warmup', activeProfiles: ALL_PROFILES });
  reducer.apply(runStartedEvent('warmup', 'run-warmup'));
  for (let index = 2; index <= 50; index += 1) {
    reducer.apply(progressEvent('warmup', 'run-warmup', index));
  }
}

describe('Narad client performance release gates', () => {
  it('parse+validate+reduce steady-state throughput stays within budget', () => {
    warmUp();
    const corpus = buildSteadyStateCorpus('session-perf', 'run-perf', RELEASE_GATE_CORPUS.steadyStateEvents);
    const elapsed = measureMedianMs([], 3, () => {
      const reducer = createNaradReducer({ sessionId: 'session-perf', activeProfiles: ALL_PROFILES });
      for (const record of corpus) {
        validateWireRecord(record, DEFAULT_NARAD_LIMITS, ALL_PROFILES);
        reducer.apply(record);
      }
    });
    expect(corpus).toHaveLength(RELEASE_GATE_CORPUS.steadyStateEvents);
    expect(elapsed).toBeLessThan(RELEASE_GATE_BUDGETS.steadyStateParseValidateReduceMs);
  });

  it('replays large deterministic authority trace within budget', () => {
    warmUp();
    const authority = loadAuthorityReplayCorpus();
    const synthetic = buildSteadyStateCorpus(
      'session-large',
      'run-large',
      RELEASE_GATE_CORPUS.syntheticAuthorityEvents,
    );
    const corpus = [...authority, ...synthetic.slice(1)];
    const elapsed = measureMedianMs([], 3, () => {
      const sessionId =
        (authority.find((record) => typeof (record as Record<string, unknown>).sessionId === 'string') as
          | Record<string, unknown>
          | undefined)?.sessionId?.toString() ?? 'session-large';
      const reducer = createNaradReducer({ sessionId, activeProfiles: ALL_PROFILES });
      for (const record of corpus) {
        reducer.apply(record);
      }
    });
    expect(corpus.length).toBeGreaterThanOrEqual(
      authority.length + RELEASE_GATE_CORPUS.syntheticAuthorityEvents - 1,
    );
    expect(elapsed).toBeLessThan(RELEASE_GATE_BUDGETS.largeAuthorityReplayMs);
  });

  it('gap recovery backfill stays within budget', () => {
    warmUp();
    const sessionId = 'session-gap';
    const rootRunId = 'run-gap';
    const head = buildSteadyStateCorpus(sessionId, rootRunId, 50);
    const gapFill = buildSteadyStateCorpus(sessionId, rootRunId, RELEASE_GATE_CORPUS.gapBackfillEvents).slice(50);
    const elapsed = measureMedianMs([], 3, () => {
      const reducer = createNaradReducer({ sessionId, activeProfiles: ALL_PROFILES });
      for (const record of head) {
        reducer.apply(record);
      }
      reducer.clearSessionGap();
      for (const record of gapFill) {
        reducer.apply(record);
      }
    });
    expect(gapFill.length).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(RELEASE_GATE_BUDGETS.gapBackfillMs);
  });

  it('graph and progress hydrate replay stays within budget', () => {
    warmUp();
    const corpus = loadGraphProgressCorpus();
    const elapsed = measureMedianMs([], 3, () => {
      const sessionId =
        (corpus.find((record) => typeof (record as Record<string, unknown>).sessionId === 'string') as
          | Record<string, unknown>
          | undefined)?.sessionId?.toString() ?? 'session-graph';
      const reducer = createNaradReducer({ sessionId, activeProfiles: ALL_PROFILES });
      for (const record of corpus) {
        reducer.apply(record);
      }
    });
    expect(corpus.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(RELEASE_GATE_BUDGETS.graphProgressReplayMs);
  });

  it('dedup and history growth stay capped without exact heap measurement', () => {
    const limits = {
      ...DEFAULT_NARAD_LIMITS,
      maxHistoryEvents: 128,
    };
    const store = new Map<string, { fingerprint: string; sessionSequence: number }>();
    for (let index = 0; index < limits.maxHistoryEvents + RELEASE_GATE_CORPUS.dedupOverflowEvents; index += 1) {
      const event = {
        type: 'progress.recorded',
        eventId: `evt-${index}`,
        sessionSequence: index + 1,
      };
      commitEventFingerprint(store, `session-dedup:evt-${index}`, event, index + 1, limits);
    }
    expect(store.size).toBeLessThanOrEqual(limits.maxHistoryEvents);
    expect(limits.maxHistoryEvents).toBeLessThanOrEqual(RELEASE_GATE_BUDGETS.dedupMapMaxEntries);
  });
});
