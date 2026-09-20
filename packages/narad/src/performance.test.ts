import { describe, expect, it } from 'vitest';
import { createNaradReducer } from './reducer/index.js';
import { NARAD_PROFILE_IDS } from './types.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

function progressEvent(sessionSequence: number): Record<string, unknown> {
  return {
    type: 'progress.recorded',
    protocolVersion: 'narad/v1',
    eventId: `evt-${sessionSequence}`,
    timestamp: '2026-08-05T00:00:00Z',
    sessionId: 'session-perf',
    sessionSequence,
    rootRunId: 'run-perf',
    runId: 'run-perf',
    sequence: sessionSequence,
    progressId: `progress-${sessionSequence}`,
    category: 'phase',
    label: `Step ${sessionSequence}`,
    status: 'active',
    privacy: 'public',
  };
}

describe('reducer performance guard', () => {
  it('scales linearly with event count using deterministic apply counts', () => {
    const runStarted = {
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-0',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-perf',
      sessionSequence: 1,
      rootRunId: 'run-perf',
      runId: 'run-perf',
      sequence: 1,
    };

    function applyCount(count: number): number {
      const reducer = createNaradReducer({ sessionId: 'session-perf', activeProfiles: ALL_PROFILES });
      reducer.apply(runStarted);
      let applied = 0;
      for (let index = 2; index <= count; index += 1) {
        const result = reducer.apply(progressEvent(index));
        if (result.applied) {
          applied += 1;
        }
      }
      return applied;
    }

    const small = applyCount(200);
    const large = applyCount(800);
    expect(small).toBe(199);
    expect(large).toBe(799);
    expect(large / small).toBeCloseTo(800 / 200, 1);
  });
});
