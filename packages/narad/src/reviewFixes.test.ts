import { describe, expect, it, vi } from 'vitest';
import { createNaradClientStore, createNaradReducer, createAttachCoordinator, createClientExecutor, createSseFrameParser, validateSseAuthorityFrameId } from './index.js';
import { NARAD_PROFILE_IDS } from './types.js';
import { canonicalEventFingerprint } from './reducer/dedup.js';
import { classifyWireRecord } from './wire.js';
import {
  INVALID_CONFORMANCE_TRACES,
  POSITIVE_CONFORMANCE_TRACES,
  SPEC_ONLY_INVALID_TRACES,
  listConformanceTraces,
  loadInvalidConformanceTraces,
  loadPositiveConformanceTraces,
} from './test/fixtures/conformanceTraces.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

describe('review regression fixes', () => {
  it('rejects same eventId with different payload', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    const base = {
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    };
    expect(reducer.apply(base).applied).toBe(true);
    const conflict = reducer.apply({ ...base, clientExecutorId: 'changed' });
    expect(conflict.applied).toBe(false);
    expect(conflict.gap).toBe(true);
  });

  it('preserves snapshot identity on duplicate apply', () => {
    const store = createNaradClientStore({ sessionId: 's-dup', activeProfiles: ALL_PROFILES });
    const event = {
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's-dup',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    };
    store.apply(event);
    const first = store.getSnapshot();
    store.apply(event);
    expect(store.getSnapshot()).toBe(first);
  });

  it('attach resolves without awaiting infinite live stream', async () => {
    const reducer = createNaradReducer({ sessionId: 'session-race', activeProfiles: ALL_PROFILES });
    let resolveAttach!: () => void;
    const attachDone = new Promise<void>((resolve) => {
      resolveAttach = resolve;
    });
    const transport = {
      attach: async () => ({
        capabilities: { protocolVersion: 'narad/v1' as const, activeProfiles: ALL_PROFILES, currentSessionSequence: 0 },
        boundarySessionSequence: 0,
      }),
      subscribeLive: async function* () {
        resolveAttach();
        await new Promise<void>(() => {
          /* intentionally never completes */
        });
      },
      fetchHistory: async () => ({ events: [], nextSessionSequence: null }),
      sendControl: async () => {},
      dispose: () => {},
    };
    const coordinator = createAttachCoordinator(transport, reducer, { sessionId: 'session-race' });
    const attachPromise = coordinator.attach();
    await Promise.race([attachPromise, attachDone]);
    await attachPromise;
    expect(coordinator.getSnapshot().live).toBe(true);
    coordinator.dispose();
  });

  it('fails closed on pending overflow', async () => {
    const reducer = createNaradReducer({ sessionId: 's-overflow', activeProfiles: ALL_PROFILES });
    const transport = {
      attach: async () => ({
        capabilities: { protocolVersion: 'narad/v1' as const, activeProfiles: ALL_PROFILES, currentSessionSequence: 0 },
        boundarySessionSequence: 0,
      }),
      subscribeLive: async function* () {
        yield {
          type: 'run.started',
          protocolVersion: 'narad/v1',
          eventId: 'overflow-1',
          timestamp: '2026-08-05T00:00:00Z',
          sessionId: 's-overflow',
          sessionSequence: 999,
          rootRunId: 'r1',
          runId: 'r1',
          sequence: 1,
        };
        yield {
          type: 'run.started',
          protocolVersion: 'narad/v1',
          eventId: 'overflow-2',
          timestamp: '2026-08-05T00:00:01Z',
          sessionId: 's-overflow',
          sessionSequence: 1000,
          rootRunId: 'r2',
          runId: 'r2',
          sequence: 1,
        };
      },
      fetchHistory: async () => ({ events: [], nextSessionSequence: null }),
      sendControl: async () => {},
      dispose: () => {},
    };
    const coordinator = createAttachCoordinator(transport, reducer, {
      sessionId: 's-overflow',
      limits: { maxFrameBytes: 1024, maxEventBytes: 1024, maxJsonDepth: 32, maxHistoryEvents: 100, maxPendingQueue: 1 },
    });
    await expect(coordinator.attach()).rejects.toThrow(/overflow/i);
    expect(coordinator.getSnapshot().resyncRequired).toBe(true);
  });

  it('requires SSE id for authority frames', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: {"type":"run.started","eventId":"e1"}\n\n');
    expect(() =>
      validateSseAuthorityFrameId(frames[0]!, {
        type: 'run.started',
        eventId: 'e1',
      }),
    ).toThrow(/requires id/i);
  });

  it('supports executor cancelToolExecution instance method', async () => {
    const finish = vi.fn(async () => {});
    let abort: AbortSignal | undefined;
    const executor = createClientExecutor({
      handlers: [
        {
          toolName: 'slow.tool',
          execute: (_args, context) =>
            new Promise(() => {
              abort = context.signal;
            }),
        },
      ],
      sendFinish: finish,
      now: () => new Date('2026-08-05T00:00:00Z'),
    });
    await executor.handleControl({
      type: 'client.attached',
      protocolVersion: 'narad/v1',
      clientExecutorId: 'desktop-1',
      leaseId: 'lease-1',
      heartbeatIntervalMs: 15000,
      leaseExpiresAt: '2026-08-05T01:00:00Z',
    });
    void executor.handleControl({
      type: 'client.tool.execute',
      protocolVersion: 'narad/v1',
      clientExecutorId: 'desktop-1',
      leaseId: 'lease-1',
      executionToken: 'token-1',
      executionTokenExpiresAt: '2026-08-05T01:00:00Z',
      toolCallId: 'tool-1',
      toolName: 'slow.tool',
      args: {},
    });
    expect(executor.cancelToolExecution('tool-1')).toBe(true);
    expect(abort?.aborted).toBe(true);
    executor.dispose();
  });

  it('rejects execute for mismatched clientExecutorId', async () => {
    const executor = createClientExecutor({
      handlers: [{ toolName: 'open.file', execute: vi.fn(async () => ({})) }],
      sendFinish: vi.fn(async () => {}),
    });
    await executor.handleControl({
      type: 'client.attached',
      protocolVersion: 'narad/v1',
      clientExecutorId: 'desktop-1',
      leaseId: 'lease-1',
      heartbeatIntervalMs: 15000,
      leaseExpiresAt: '2026-08-05T01:00:00Z',
    });
    await expect(
      executor.handleControl({
        type: 'client.tool.execute',
        protocolVersion: 'narad/v1',
        clientExecutorId: 'other-executor',
        leaseId: 'lease-1',
        executionToken: 'token-1',
        executionTokenExpiresAt: '2026-08-05T01:00:00Z',
        toolCallId: 'tool-1',
        toolName: 'open.file',
        args: {},
      }),
    ).rejects.toMatchObject({ code: 'executor_mismatch' });
  });

  it('marks state.compacted as resyncRequired', () => {
    const reducer = createNaradReducer({ sessionId: 's-state', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'state.snapshot',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's-state',
      sessionSequence: 1,
      scope: 'session',
      revision: 1,
      state: { count: 1 },
    });
    reducer.apply({
      type: 'state.compacted',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 's-state',
      sessionSequence: 2,
      scope: 'session',
      coversThroughSessionSequence: 2,
      snapshotRevision: 5,
    });
    const scoped = reducer.getSnapshot().scopedState.get('session:s-state');
    expect(scoped?.resyncRequired).toBe(true);
    expect(reducer.getSnapshot().resyncRequired).toBe(true);
  });

  it('clears stale reasoning on messages.snapshot hydrate', () => {
    const reducer = createNaradReducer({ sessionId: 'session-5', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'reasoning.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-r1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-5',
      sessionSequence: 1,
      reasoningId: 'reasoning-1',
    });
    reducer.apply({
      type: 'messages.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:00Z',
      snapshotId: 'snapshot-1',
      sessionId: 'session-5',
      coversThroughSessionSequence: 2,
      messages: [{ messageId: 'message-1', role: 'user', content: 'Hello' }],
    });
    expect(reducer.getSnapshot().conversation.reasoning).toEqual([]);
  });

  it('ignores empty tail messages.snapshot hydrate after authority replay', () => {
    const reducer = createNaradReducer({ sessionId: 'session-reload', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-reload',
      sessionSequence: 1,
      messageId: 'message-user',
      messageScope: 'run',
      content: 'hello',
    });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user-2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-reload',
      sessionSequence: 2,
      messageId: 'message-user-2',
      messageScope: 'run',
      content: 'world',
    });
    expect(reducer.getSnapshot().conversation.messages).toHaveLength(2);

    const result = reducer.apply({
      type: 'messages.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:00Z',
      snapshotId: 'snapshot-empty',
      sessionId: 'session-reload',
      coversThroughSessionSequence: 0,
      messages: [],
    });
    expect(result.applied).toBe(false);
    expect(reducer.getSnapshot().conversation.messages).toHaveLength(2);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(2);
  });

  it('does not clobber live user turns with a stale non-empty messages.snapshot', () => {
    const reducer = createNaradReducer({ sessionId: 'session-stale-hydrate', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user-1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-stale-hydrate',
      sessionSequence: 1,
      messageId: 'message-user-1',
      messageScope: 'run',
      content: 'roll a 55-sided die',
    });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user-2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-stale-hydrate',
      sessionSequence: 2,
      messageId: 'message-user-2',
      messageScope: 'run',
      content: 'roll a d222',
    });

    const result = reducer.apply({
      type: 'messages.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:02Z',
      snapshotId: 'snapshot-stale',
      sessionId: 'session-stale-hydrate',
      coversThroughSessionSequence: 1,
      messages: [{ messageId: 'message-user-1', role: 'user', content: 'roll a 55-sided die' }],
    });

    expect(result.applied).toBe(false);
    expect(reducer.getSnapshot().conversation.messages.map((item) => item.content)).toEqual([
      'roll a 55-sided die',
      'roll a d222',
    ]);
  });

  it('merges a stale messages.snapshot prefix without dropping later live turns', () => {
    const reducer = createNaradReducer({ sessionId: 'session-stale-merge', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user-1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-stale-merge',
      sessionSequence: 1,
      messageId: 'message-user-1',
      messageScope: 'run',
      content: 'roll a 55-sided die',
    });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user-2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-stale-merge',
      sessionSequence: 2,
      messageId: 'message-user-2',
      messageScope: 'run',
      content: 'roll a d222',
    });

    const result = reducer.apply({
      type: 'messages.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:02Z',
      snapshotId: 'snapshot-prefix',
      sessionId: 'session-stale-merge',
      coversThroughSessionSequence: 1,
      messages: [{ messageId: 'message-user-1', role: 'user', content: 'roll a 55-sided die (edited)' }],
    });

    expect(result.applied).toBe(true);
    expect(reducer.getSnapshot().conversation.messages.map((item) => item.content)).toEqual([
      'roll a 55-sided die (edited)',
      'roll a d222',
    ]);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(2);
  });

  it('applies authority 1 after a covering messages.snapshot on a fresh cursor', () => {
    const reducer = createNaradReducer({ sessionId: 'session-5', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'messages.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:00Z',
      snapshotId: 'snapshot-1',
      sessionId: 'session-5',
      coversThroughSessionSequence: 2,
      messages: [
        { messageId: 'message-1', role: 'user', content: 'Hello' },
        { messageId: 'message-2', role: 'assistant', content: 'Hi' },
      ],
    });
    const first = reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-5',
      sessionSequence: 1,
      rootRunId: 'run-5',
      runId: 'run-5',
      sequence: 1,
    });
    expect(first.applied).toBe(true);
    expect(first.gap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(1);
  });

  it('does not advance authority cursor on messages.snapshot hydrate', () => {
    const reducer = createNaradReducer({ sessionId: 'session-6', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-run',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-6',
      sessionSequence: 1,
      rootRunId: 'run-6',
      runId: 'run-6',
      sequence: 1,
    });
    reducer.apply({
      type: 'message.user.recorded',
      protocolVersion: 'narad/v1',
      eventId: 'evt-user',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-6',
      sessionSequence: 2,
      messageId: 'message-user',
      messageScope: 'run',
      content: 'Roll a d19',
    });
    reducer.apply({
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-tool',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-6',
      sessionSequence: 3,
      rootRunId: 'run-6',
      runId: 'run-6',
      sequence: 2,
      toolCallId: 'tool-1',
      toolName: 'run_skill_script',
      executor: 'backend',
      args: { sides: 19 },
    });
    expect(reducer.getSnapshot().lastSessionSequence).toBe(3);

    reducer.apply({
      type: 'messages.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:01Z',
      snapshotId: 'snapshot-6',
      sessionId: 'session-6',
      coversThroughSessionSequence: 2,
      messages: [{ messageId: 'message-user', role: 'user', content: 'Roll a d19' }],
    });
    expect(reducer.getSnapshot().lastSessionSequence).toBe(3);

    reducer.apply({
      type: 'tool.call.finished',
      protocolVersion: 'narad/v1',
      eventId: 'evt-tool-done',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'session-6',
      sessionSequence: 4,
      rootRunId: 'run-6',
      runId: 'run-6',
      sequence: 3,
      toolCallId: 'tool-1',
      outcome: 'success',
      response: { ok: true },
    });
    reducer.apply({
      type: 'interrupt.requested',
      protocolVersion: 'narad/v1',
      eventId: 'evt-interrupt',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'session-6',
      sessionSequence: 5,
      rootRunId: 'run-6',
      runId: 'run-6',
      sequence: 4,
      interruptId: 'interrupt-1',
      waitId: 'wait-1',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    reducer.apply({
      type: 'run.paused',
      protocolVersion: 'narad/v1',
      eventId: 'evt-pause',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'session-6',
      sessionSequence: 6,
      rootRunId: 'run-6',
      runId: 'run-6',
      sequence: 5,
      waitId: 'wait-1',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'interrupt-1',
    });

    const snapshot = reducer.getSnapshot();
    expect(snapshot.lastSessionSequence).toBe(6);
    expect([...snapshot.interrupts.values()].filter((item) => item.open)).toHaveLength(1);
    expect(snapshot.runs.get('run-6')?.state).toBe('paused');
  });
});

describe('conformance fixture lists', () => {
  it('match every jsonl in @devkrity/narad-spec', () => {
    const listed = [
      ...POSITIVE_CONFORMANCE_TRACES,
      ...INVALID_CONFORMANCE_TRACES,
      ...SPEC_ONLY_INVALID_TRACES,
    ].sort();
    expect(listed).toEqual([...listConformanceTraces()].sort());
  });
});

describe('invalid conformance traces fail closed', () => {
  for (const trace of loadInvalidConformanceTraces()) {
    it(`rejects ${trace.name}`, () => {
      const sessionId =
        (trace.lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((record) => typeof record.sessionId === 'string')?.sessionId as string | undefined) ??
        'session-invalid';
      const reducer = createNaradReducer({ sessionId, activeProfiles: ALL_PROFILES });
      let rejected = false;
      for (const line of trace.lines) {
        const result = reducer.apply(JSON.parse(line) as unknown);
        if (!result.applied && (result.gap || result.error)) {
          rejected = true;
          break;
        }
      }
      expect(rejected).toBe(true);
    });
  }
});

describe('positive conformance traces', () => {
  for (const trace of loadPositiveConformanceTraces()) {
    it(`replays ${trace.name}`, () => {
      const sessionId =
        (trace.lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((record) => typeof record.sessionId === 'string')?.sessionId as string | undefined) ??
        'session-unknown';
      const reducer = createNaradReducer({ sessionId, activeProfiles: ALL_PROFILES });
      const errors: string[] = [];
      for (const line of trace.lines) {
        const value = JSON.parse(line) as unknown;
        if (classifyWireRecord(value) === 'control') {
          continue;
        }
        const result = reducer.apply(value);
        if (result.error) errors.push(result.error);
      }
      expect(errors).toEqual([]);
    });
  }
});

describe('fingerprint helper', () => {
  it('is deterministic', () => {
    const event = { type: 'run.started', eventId: 'e1', sessionSequence: 1 };
    expect(canonicalEventFingerprint(event)).toBe(canonicalEventFingerprint(event));
  });
});
