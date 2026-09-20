import { describe, expect, it } from 'vitest';
import { createNaradReducer } from './reducer/index.js';
import { NARAD_PROFILE_IDS } from './types.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);
const SESSION_ID = 'session-hitl';
const ROOT_RUN_ID = 'run-hitl-root';

describe('HITL continuation run.resumed', () => {
  it('accepts waitId-based run.resumed after interrupt.resolved', () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const base = {
      protocolVersion: 'narad/v1' as const,
      sessionId: SESSION_ID,
      rootRunId: ROOT_RUN_ID,
      runId: ROOT_RUN_ID,
    };

    reducer.apply({
      ...base,
      type: 'run.started',
      eventId: 'evt-1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionSequence: 1,
      sequence: 1,
    });
    reducer.apply({
      ...base,
      type: 'interrupt.requested',
      eventId: 'evt-2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionSequence: 2,
      sequence: 2,
      interruptId: 'approval-1',
      waitId: 'wait:approval-1',
      kind: 'approval',
      actions: ['approve'],
    });
    reducer.apply({
      ...base,
      type: 'run.paused',
      eventId: 'evt-3',
      timestamp: '2026-08-05T00:00:01Z',
      sessionSequence: 3,
      sequence: 3,
      waitId: 'wait:approval-1',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'approval-1',
    });
    reducer.apply({
      ...base,
      type: 'interrupt.resolved',
      eventId: 'evt-4',
      timestamp: '2026-08-05T00:00:02Z',
      sessionSequence: 4,
      sequence: 4,
      interruptId: 'approval-1',
      waitId: 'wait:approval-1',
      decision: 'approve',
    });

    const resumed = reducer.apply({
      ...base,
      type: 'run.resumed',
      eventId: 'evt-5',
      timestamp: '2026-08-05T00:00:03Z',
      sessionSequence: 5,
      sequence: 5,
      waitId: 'wait:approval-1',
    });

    expect(resumed.applied).toBe(true);
    expect(reducer.getSnapshot().runs.get(ROOT_RUN_ID)?.state).toBe('running');
    expect(reducer.getSnapshot().lastSessionSequence).toBe(5);
  });

  it('latches a session gap when packed HITL emits a pause per TARC (live producer bug)', () => {
    // Live session-9ce566… journaled interrupt+pause for each packed TARC.
    // Narad: interrupt requires running; a second pause requires no open wait.
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const base = {
      protocolVersion: 'narad/v1' as const,
      sessionId: SESSION_ID,
      rootRunId: ROOT_RUN_ID,
      runId: ROOT_RUN_ID,
    };

    reducer.apply({
      ...base,
      type: 'run.started',
      eventId: 'evt-1',
      timestamp: '2026-08-28T00:00:00Z',
      sessionSequence: 1,
      sequence: 1,
    });
    reducer.apply({
      ...base,
      type: 'interrupt.requested',
      eventId: 'evt-53',
      timestamp: '2026-08-28T00:00:01Z',
      sessionSequence: 2,
      sequence: 2,
      interruptId: 'ficc_16533c9b',
      waitId: 'wait:ficc_16533c9b',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    reducer.apply({
      ...base,
      type: 'run.paused',
      eventId: 'evt-54',
      timestamp: '2026-08-28T00:00:01Z',
      sessionSequence: 3,
      sequence: 3,
      waitId: 'wait:ficc_16533c9b',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'ficc_16533c9b',
    });

    const secondInterrupt = reducer.apply({
      ...base,
      type: 'interrupt.requested',
      eventId: 'evt-55',
      timestamp: '2026-08-28T00:00:02Z',
      sessionSequence: 4,
      sequence: 4,
      interruptId: 'ficc_42dad8ef',
      waitId: 'wait:ficc_42dad8ef',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    expect(secondInterrupt.applied).toBe(false);
    expect(secondInterrupt.gap).toBe(false);
    expect(secondInterrupt.error).toBe('Interrupt requires a running run.');
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(3);

    const secondPause = reducer.apply({
      ...base,
      type: 'run.paused',
      eventId: 'evt-56',
      timestamp: '2026-08-28T00:00:02Z',
      sessionSequence: 5,
      sequence: 5,
      waitId: 'wait:ficc_42dad8ef',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'ficc_42dad8ef',
    });
    expect(secondPause.applied).toBe(false);
    expect(secondPause.gap).toBe(true);
    expect(secondPause.error).toBe('Session sequence gap detected.');
    expect(reducer.getSnapshot().sessionGap).toBe(true);

    const later = reducer.apply({
      ...base,
      type: 'interrupt.resolved',
      eventId: 'evt-59',
      timestamp: '2026-08-28T00:00:03Z',
      sessionSequence: 6,
      sequence: 6,
      interruptId: 'ficc_16533c9b',
      waitId: 'wait:ficc_16533c9b',
      decision: 'approve',
    });
    expect(later.applied).toBe(false);
    expect(later.error).toBe('Session gap active.');
    expect(reducer.getSnapshot().interrupts.get('ficc_16533c9b')?.open).toBe(true);
  });

  it('rejects a second interrupt before the consecutive pause', () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const base = {
      protocolVersion: 'narad/v1' as const,
      sessionId: SESSION_ID,
      rootRunId: ROOT_RUN_ID,
      runId: ROOT_RUN_ID,
    };

    reducer.apply({
      ...base,
      type: 'run.started',
      eventId: 'evt-1',
      timestamp: '2026-08-28T00:00:00Z',
      sessionSequence: 1,
      sequence: 1,
    });
    reducer.apply({
      ...base,
      type: 'interrupt.requested',
      eventId: 'evt-2',
      timestamp: '2026-08-28T00:00:01Z',
      sessionSequence: 2,
      sequence: 2,
      interruptId: 'ficc_16533c9b',
      waitId: 'wait:ficc_16533c9b',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });

    const second = reducer.apply({
      ...base,
      type: 'interrupt.requested',
      eventId: 'evt-3',
      timestamp: '2026-08-28T00:00:01Z',
      sessionSequence: 3,
      sequence: 3,
      interruptId: 'ficc_42dad8ef',
      waitId: 'wait:ficc_42dad8ef',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    expect(second.applied).toBe(false);
    expect(second.error).toBe('Pause must follow interrupt consecutively.');
  });

  it('accepts one packed interrupt then consecutive pause', () => {
    const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
    const base = {
      protocolVersion: 'narad/v1' as const,
      sessionId: SESSION_ID,
      rootRunId: ROOT_RUN_ID,
      runId: ROOT_RUN_ID,
    };

    reducer.apply({
      ...base,
      type: 'run.started',
      eventId: 'evt-1',
      timestamp: '2026-08-28T00:00:00Z',
      sessionSequence: 1,
      sequence: 1,
    });
    const interrupt = reducer.apply({
      ...base,
      type: 'interrupt.requested',
      eventId: 'evt-2',
      timestamp: '2026-08-28T00:00:01Z',
      sessionSequence: 2,
      sequence: 2,
      interruptId: 'ficc_16533c9b',
      waitId: 'wait:ficc_16533c9b',
      kind: 'approval',
      actions: ['approve', 'deny'],
      input: {
        toolCallId: 'call-1',
        toolName: 'invoke_agent_roller',
      },
    });
    const paused = reducer.apply({
      ...base,
      type: 'run.paused',
      eventId: 'evt-3',
      timestamp: '2026-08-28T00:00:01Z',
      sessionSequence: 3,
      sequence: 3,
      waitId: 'wait:ficc_16533c9b',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'ficc_16533c9b',
    });
    expect(interrupt.applied).toBe(true);
    expect(paused.applied).toBe(true);
    expect(paused.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().runs.get(ROOT_RUN_ID)?.state).toBe('paused');
    expect(reducer.getSnapshot().runs.get(ROOT_RUN_ID)?.openWaitId).toBe('wait:ficc_16533c9b');
    expect(
      [...reducer.getSnapshot().interrupts.values()].filter((item) => item.open).map((item) => item.interruptId),
    ).toEqual(['ficc_16533c9b']);
  });
});
