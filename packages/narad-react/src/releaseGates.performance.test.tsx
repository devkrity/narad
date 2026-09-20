import { render, act } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  NARAD_PROFILE_IDS,
  createNaradClientStore,
  type NaradSessionSnapshot,
} from '@devkrity/narad';
import { NaradProvider, useNaradSelector } from './NaradProvider';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

function runStarted(sessionId: string, rootRunId: string): Record<string, unknown> {
  return {
    type: 'run.started',
    protocolVersion: 'narad/v1',
    eventId: 'evt-1',
    timestamp: '2026-08-05T00:00:00Z',
    sessionId,
    sessionSequence: 1,
    rootRunId,
    runId: rootRunId,
    sequence: 1,
  };
}

function progress(sessionId: string, rootRunId: string, sessionSequence: number): Record<string, unknown> {
  return {
    type: 'progress.recorded',
    protocolVersion: 'narad/v1',
    eventId: `evt-${sessionSequence}`,
    timestamp: '2026-08-05T00:00:00Z',
    sessionId,
    sessionSequence,
    rootRunId,
    runId: rootRunId,
    sequence: sessionSequence,
    progressId: `progress-${sessionSequence}`,
    category: 'phase',
    label: `Step ${sessionSequence}`,
    status: 'active',
    privacy: 'public',
  };
}

const selectRevision = (snapshot: NaradSessionSnapshot) => snapshot.lastSessionSequence;
const revisionEqual = (previous: number, next: number) => previous === next;

describe('Narad React performance release gates', () => {
  it('batches external-store notifications and preserves no-op identity', () => {
    const store = createNaradClientStore({ sessionId: 'react-perf', activeProfiles: ALL_PROFILES });
    store.apply(runStarted('react-perf', 'run-react'));

    let renderCount = 0;
    let lastSelection: number | null = null;

    function Probe() {
      renderCount += 1;
      const revision = useNaradSelector(selectRevision, revisionEqual);
      lastSelection = revision;
      return <span>{revision}</span>;
    }

    render(
      <NaradProvider store={store}>
        <Probe />
      </NaradProvider>,
    );

    const rendersAfterMount = renderCount;
    const identityBefore = lastSelection;

    act(() => {
      store.clearSessionGap();
    });

    expect(renderCount).toBe(rendersAfterMount);
    expect(lastSelection).toBe(identityBefore);

    act(() => {
      for (let index = 2; index <= 120; index += 1) {
        store.apply(progress('react-perf', 'run-react', index));
      }
    });

    expect(renderCount).toBeGreaterThan(rendersAfterMount);
    expect(renderCount).toBeLessThanOrEqual(rendersAfterMount + 120);
    expect(lastSelection).toBe(120);
  });
});
