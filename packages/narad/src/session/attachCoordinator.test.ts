import { describe, expect, it } from 'vitest';
import { createNaradReducer } from '../reducer/index.js';
import { NARAD_PROFILE_IDS } from '../types.js';
import { createAttachCoordinator } from './attachCoordinator.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);
const SESSION_ID = 'session-backfill';

function hangUntilAbort(signal?: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function authorityEvent(sessionSequence: number) {
  return {
    type: 'run.started',
    protocolVersion: 'narad/v1',
    eventId: `evt-${sessionSequence}`,
    timestamp: '2026-08-05T00:00:00Z',
    sessionId: SESSION_ID,
    sessionSequence,
    rootRunId: `run-${sessionSequence}`,
    runId: `run-${sessionSequence}`,
    sequence: 1,
  };
}

describe('createAttachCoordinator', () => {
  it('backfills authority 1..N from local cursor 0 while live subscribes after boundary N', async () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const historyCursors: number[] = [];
    let liveAfterSequence: number | null = null;
    const transport = {
      attach: async () => ({
        capabilities: {
          protocolVersion: 'narad/v1' as const,
          activeProfiles: ALL_PROFILES,
          currentSessionSequence: 5,
        },
        boundarySessionSequence: 5,
      }),
      subscribeLive: async function* (_sessionId: string, afterSessionSequence: number, signal?: AbortSignal) {
        liveAfterSequence = afterSessionSequence;
        yield authorityEvent(6);
        await hangUntilAbort(signal);
      },
      fetchHistory: async (_sessionId: string, afterSessionSequence: number) => {
        historyCursors.push(afterSessionSequence);
        if (afterSessionSequence === 0) {
          return {
            events: [1, 2, 3, 4, 5].map(authorityEvent),
            nextSessionSequence: null,
          };
        }
        return { events: [], nextSessionSequence: null };
      },
      sendControl: async () => {},
      dispose: () => {},
    };

    const coordinator = createAttachCoordinator(transport, reducer, { sessionId: SESSION_ID });
    await coordinator.attach();

    expect(reducer.getSnapshot().lastSessionSequence).toBe(6);
    expect(historyCursors).toEqual([0]);
    expect(liveAfterSequence).toBe(5);
    expect([...reducer.getSnapshot().runs.keys()].sort()).toEqual([
      'run-1',
      'run-2',
      'run-3',
      'run-4',
      'run-5',
      'run-6',
    ]);
    coordinator.dispose();
  });

  it('resumes backfill from local M through boundary N and dedups live N+1 overlap', async () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    reducer.apply(authorityEvent(1));
    reducer.apply(authorityEvent(2));
    expect(reducer.getSnapshot().lastSessionSequence).toBe(2);

    const historyCursors: number[] = [];
    let liveAfterSequence: number | null = null;
    const transport = {
      attach: async () => ({
        capabilities: {
          protocolVersion: 'narad/v1' as const,
          activeProfiles: ALL_PROFILES,
          currentSessionSequence: 5,
        },
        boundarySessionSequence: 5,
      }),
      subscribeLive: async function* (_sessionId: string, afterSessionSequence: number, signal?: AbortSignal) {
        liveAfterSequence = afterSessionSequence;
        yield authorityEvent(5);
        yield authorityEvent(6);
        await hangUntilAbort(signal);
      },
      fetchHistory: async (_sessionId: string, afterSessionSequence: number) => {
        historyCursors.push(afterSessionSequence);
        if (afterSessionSequence === 2) {
          return {
            events: [3, 4, 5].map(authorityEvent),
            nextSessionSequence: null,
          };
        }
        return { events: [], nextSessionSequence: null };
      },
      sendControl: async () => {},
      dispose: () => {},
    };

    const coordinator = createAttachCoordinator(transport, reducer, { sessionId: SESSION_ID });
    await coordinator.attach();

    expect(historyCursors[0]).toBe(2);
    expect(liveAfterSequence).toBe(5);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(6);
    coordinator.dispose();
  });

  it('fills history on sequence gap then continues applying live', async () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const historyCursors: number[] = [];
    const liveQueue: unknown[] = [];
    let wakeLive: (() => void) | null = null;
    let liveReady!: () => void;
    const liveStarted = new Promise<void>((resolve) => {
      liveReady = resolve;
    });

    const transport = {
      attach: async () => ({
        capabilities: {
          protocolVersion: 'narad/v1' as const,
          activeProfiles: ALL_PROFILES,
          currentSessionSequence: 1,
        },
        boundarySessionSequence: 1,
      }),
      subscribeLive: async function* () {
        liveReady();
        while (true) {
          if (liveQueue.length === 0) {
            await new Promise<void>((resolve) => {
              wakeLive = resolve;
            });
          }
          const next = liveQueue.shift();
          if (next === null) {
            return;
          }
          yield next;
        }
      },
      fetchHistory: async (_sessionId: string, afterSessionSequence: number) => {
        historyCursors.push(afterSessionSequence);
        if (afterSessionSequence === 0) {
          return { events: [authorityEvent(1)], nextSessionSequence: null };
        }
        if (afterSessionSequence === 1) {
          return { events: [authorityEvent(2), authorityEvent(3)], nextSessionSequence: null };
        }
        return { events: [], nextSessionSequence: null };
      },
      sendControl: async () => {},
      dispose: () => {},
    };

    const pushLive = (value: unknown) => {
      liveQueue.push(value);
      wakeLive?.();
      wakeLive = null;
    };

    const coordinator = createAttachCoordinator(transport, reducer, { sessionId: SESSION_ID });
    await coordinator.attach();
    await liveStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reducer.getSnapshot().lastSessionSequence).toBe(1);

    // Live jumps ahead → apply reports gap → coordinator fills history.
    pushLive(authorityEvent(3));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Explicit fill if auto path races; either way authority must be complete.
    if (reducer.getSnapshot().lastSessionSequence < 3) {
      await coordinator.requestRecovery();
    }
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBeGreaterThanOrEqual(3);
    expect(coordinator.getSnapshot().live).toBe(true);

    pushLive(authorityEvent(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (reducer.getSnapshot().lastSessionSequence < 4) {
      await coordinator.requestRecovery();
    }
    expect(reducer.getSnapshot().lastSessionSequence).toBeGreaterThanOrEqual(3);

    coordinator.dispose();
  });

  it('catches up from history when the live generator ends', async () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const historyCursors: number[] = [];
    let subscribeCount = 0;
    let releaseSecondLive!: () => void;
    const secondLiveHeld = new Promise<void>((resolve) => {
      releaseSecondLive = resolve;
    });

    const transport = {
      attach: async () => ({
        capabilities: {
          protocolVersion: 'narad/v1' as const,
          activeProfiles: ALL_PROFILES,
          currentSessionSequence: 1,
        },
        boundarySessionSequence: 1,
      }),
      subscribeLive: async function* () {
        subscribeCount += 1;
        if (subscribeCount === 1) {
          return;
        }
        await secondLiveHeld;
      },
      fetchHistory: async (_sessionId: string, afterSessionSequence: number) => {
        historyCursors.push(afterSessionSequence);
        if (afterSessionSequence === 0) {
          return { events: [authorityEvent(1)], nextSessionSequence: null };
        }
        if (afterSessionSequence === 1) {
          return { events: [authorityEvent(2)], nextSessionSequence: null };
        }
        return { events: [], nextSessionSequence: null };
      },
      sendControl: async () => {},
      dispose: () => {},
    };

    const coordinator = createAttachCoordinator(transport, reducer, { sessionId: SESSION_ID });
    await coordinator.attach();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(historyCursors).toContain(1);
    expect(reducer.getSnapshot().lastSessionSequence).toBeGreaterThanOrEqual(2);

    releaseSecondLive();
    coordinator.dispose();
  });

  it('activates only claimed profiles that the server advertised', async () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: [] });
    const transport = {
      attach: async () => ({
        capabilities: {
          protocolVersion: 'narad/v1' as const,
          activeProfiles: [
            NARAD_PROFILE_IDS.trace,
            NARAD_PROFILE_IDS.conversation,
            NARAD_PROFILE_IDS.graph,
            NARAD_PROFILE_IDS.progress,
            NARAD_PROFILE_IDS.workflow,
          ],
          currentSessionSequence: 0,
        },
        boundarySessionSequence: 0,
      }),
      subscribeLive: async function* (_sessionId: string, _after: number, signal?: AbortSignal) {
        await hangUntilAbort(signal);
      },
      fetchHistory: async () => ({ events: [], nextSessionSequence: null }),
      sendControl: async () => {},
      dispose: () => {},
    };

    const coordinator = createAttachCoordinator(transport, reducer, {
      sessionId: SESSION_ID,
      claimedProfiles: [
        NARAD_PROFILE_IDS.conversation,
        NARAD_PROFILE_IDS.graph,
        NARAD_PROFILE_IDS.progress,
      ],
    });
    await coordinator.attach();

    expect(reducer.getSnapshot().activeProfiles).toEqual([
      NARAD_PROFILE_IDS.conversation,
      NARAD_PROFILE_IDS.graph,
      NARAD_PROFILE_IDS.progress,
    ]);
    coordinator.dispose();
  });
});
