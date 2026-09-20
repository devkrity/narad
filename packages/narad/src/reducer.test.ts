import { describe, expect, it } from 'vitest';
import { createNaradReducer } from './reducer/index.js';
import { NARAD_PROFILE_IDS } from './types.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

describe('createNaradReducer gaps and ordering', () => {
  it('detects session sequence gap', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    const gap = reducer.apply({
      type: 'run.finished',
      protocolVersion: 'narad/v1',
      eventId: 'e3',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 's1',
      sessionSequence: 3,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 2,
    });
    expect(gap.gap).toBe(true);
    expect(reducer.getSnapshot().sessionGap).toBe(true);
  });

  it('ignores foreign-session authority events without opening a gap', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'parent-session',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    const foreign = reducer.apply({
      type: 'interrupt.requested',
      protocolVersion: 'narad/v1',
      eventId: 'child-interrupt',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'child-session',
      sessionSequence: 2,
      rootRunId: 'r-child',
      runId: 'r-child',
      sequence: 1,
      interruptId: 'apr-inner',
      waitId: 'wait:apr-inner',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    expect(foreign.applied).toBe(false);
    expect(foreign.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(1);
  });

  it('applies AAAT parent session-lane projections without run-tree sequence', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'parent-session',
      sessionSequence: 1,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 1,
    });
    reducer.apply({
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'parent-session',
      sessionSequence: 2,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 2,
      toolCallId: 'invoke-1',
      toolName: 'invoke_agent_roller',
      executor: 'backend',
      args: {},
    });
    const childStarted = reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'aaatproj:child-run',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'parent-session',
      sessionSequence: 3,
      rootRunId: 'root-1',
      runId: 'child-1',
      sourceEventId: 'child-run',
      sourceSessionId: 'child-session',
      parentRunId: 'root-1',
      parentToolCallId: 'invoke-1',
    });
    expect(childStarted.applied).toBe(true);
    expect(childStarted.gap).toBe(false);
    const interrupt = reducer.apply({
      type: 'interrupt.requested',
      protocolVersion: 'narad/v1',
      eventId: 'aaatproj:child-interrupt',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 'parent-session',
      sessionSequence: 4,
      rootRunId: 'root-1',
      runId: 'child-1',
      sourceEventId: 'child-interrupt',
      sourceSessionId: 'child-session',
      interruptId: 'apr-inner',
      waitId: 'wait:apr-inner',
      kind: 'approval',
      actions: ['approve', 'deny'],
      input: { toolCallId: 'tool-dice', toolName: 'run_skill_script' },
    });
    expect(interrupt.applied).toBe(true);
    expect(interrupt.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().runs.get('child-1')?.state).toBe('running');
    expect(reducer.getSnapshot().interrupts.get('apr-inner')?.open).toBe(true);
    // Parent root run-tree cursor must still accept the next parent-owned sequence.
    const parentToolFinished = reducer.apply({
      type: 'tool.call.finished',
      protocolVersion: 'narad/v1',
      eventId: 'e5',
      timestamp: '2026-08-05T00:00:04Z',
      sessionId: 'parent-session',
      sessionSequence: 5,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 3,
      toolCallId: 'invoke-1',
      outcome: 'success',
      response: {},
    });
    expect(parentToolFinished.applied).toBe(true);
    expect(parentToolFinished.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
  });

  it('advances parent session lane when AAAT projection arrives without prior child run', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'parent-session',
      sessionSequence: 1,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 1,
    });
    const interrupt = reducer.apply({
      type: 'interrupt.requested',
      protocolVersion: 'narad/v1',
      eventId: 'aaatproj:orphan-interrupt',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'parent-session',
      sessionSequence: 2,
      rootRunId: 'root-1',
      runId: 'child-missing',
      sourceEventId: 'child-interrupt',
      sourceSessionId: 'child-session',
      interruptId: 'apr-orphan',
      waitId: 'wait:apr-orphan',
      kind: 'approval',
      actions: ['approve', 'deny'],
      input: { toolCallId: 'tool-dice', toolName: 'run_skill_script' },
    });
    expect(interrupt.applied).toBe(true);
    expect(interrupt.gap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(2);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().interrupts.get('apr-orphan')?.open).toBe(true);
    const resolved = reducer.apply({
      type: 'interrupt.resolved',
      protocolVersion: 'narad/v1',
      eventId: 'aaatproj:orphan-resolved',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'parent-session',
      sessionSequence: 3,
      rootRunId: 'root-1',
      runId: 'child-missing',
      sourceEventId: 'child-resolved',
      sourceSessionId: 'child-session',
      interruptId: 'apr-orphan',
      waitId: 'wait:apr-orphan',
      decision: 'approve',
    });
    expect(resolved.applied).toBe(true);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(3);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
  });

  it('replays roll-a-dNNN parent lane through inner pause and canonical child finish without gap', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    const rootRunId = 'root-parent';
    const childRunId = 'child-roller';
    const apply = (event: Record<string, unknown>) => {
      const result = reducer.apply({ protocolVersion: 'narad/v1', sessionId: 'parent-session', ...event });
      expect(result.gap, JSON.stringify({ event, result })).toBe(false);
      expect(result.applied, JSON.stringify({ event, result })).toBe(true);
      return result;
    };

    apply({
      type: 'run.started',
      eventId: 'e1',
      timestamp: '2026-08-07T15:10:50Z',
      sessionSequence: 1,
      rootRunId,
      runId: rootRunId,
      sequence: 1,
    });
    apply({
      type: 'interrupt.requested',
      eventId: 'e4',
      timestamp: '2026-08-07T15:10:51Z',
      sessionSequence: 2,
      rootRunId,
      runId: rootRunId,
      sequence: 2,
      interruptId: 'apr-outer',
      waitId: 'wait:apr-outer',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    apply({
      type: 'run.paused',
      eventId: 'e5',
      timestamp: '2026-08-07T15:10:51Z',
      sessionSequence: 3,
      rootRunId,
      runId: rootRunId,
      sequence: 3,
      waitId: 'wait:apr-outer',
      reason: 'tool_approval',
      resumeMode: 'command',
    });
    apply({
      type: 'interrupt.resolved',
      eventId: 'e6',
      timestamp: '2026-08-07T15:10:52Z',
      sessionSequence: 4,
      rootRunId,
      runId: rootRunId,
      sequence: 4,
      interruptId: 'apr-outer',
      waitId: 'wait:apr-outer',
      decision: 'approve',
    });
    apply({
      type: 'run.resumed',
      eventId: 'e7',
      timestamp: '2026-08-07T15:10:52Z',
      sessionSequence: 5,
      rootRunId,
      runId: rootRunId,
      sequence: 5,
      waitId: 'wait:apr-outer',
    });
    apply({
      type: 'tool.call.started',
      eventId: 'e9',
      timestamp: '2026-08-07T15:10:53Z',
      sessionSequence: 6,
      rootRunId,
      runId: rootRunId,
      sequence: 6,
      toolCallId: 'invoke-1',
      toolName: 'invoke_agent_roller',
      executor: 'backend',
      args: { message: 'roll a d100' },
    });
    apply({
      type: 'run.started',
      eventId: 'aaatproj:child-run',
      timestamp: '2026-08-07T15:10:53Z',
      sessionSequence: 7,
      rootRunId,
      runId: childRunId,
      sourceEventId: 'child-run',
      sourceSessionId: 'child-session',
      parentRunId: rootRunId,
      parentToolCallId: 'invoke-1',
    });
    apply({
      type: 'interrupt.requested',
      eventId: 'aaatproj:child-interrupt',
      timestamp: '2026-08-07T15:10:54Z',
      sessionSequence: 8,
      rootRunId,
      runId: childRunId,
      sourceEventId: 'child-interrupt',
      sourceSessionId: 'child-session',
      interruptId: 'apr-inner',
      waitId: 'wait:apr-inner',
      kind: 'approval',
      actions: ['approve', 'deny'],
    });
    apply({
      type: 'run.paused',
      eventId: 'aaatproj:child-pause',
      timestamp: '2026-08-07T15:10:54Z',
      sessionSequence: 9,
      rootRunId,
      runId: childRunId,
      sourceEventId: 'child-pause',
      sourceSessionId: 'child-session',
      waitId: 'wait:apr-inner',
      reason: 'tool_approval',
      resumeMode: 'command',
    });
    apply({
      type: 'run.finished',
      eventId: 'child-finish-canonical',
      timestamp: '2026-08-07T15:11:02Z',
      sessionSequence: 10,
      rootRunId,
      runId: childRunId,
      sequence: 1,
      parentRunId: rootRunId,
      parentToolCallId: 'invoke-1',
    });

    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(10);
    expect(reducer.getSnapshot().runs.get(childRunId)?.state).toBe('finished');
  });

  it('session attach does not gap on root-sequence jumps consumed by nested child sessions', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'parent-session',
      sessionSequence: 1,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 1,
    });
    reducer.apply({
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'parent-session',
      sessionSequence: 2,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 2,
      toolCallId: 'invoke-1',
      toolName: 'invoke_agent_roller',
      executor: 'backend',
      args: {},
    });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'aaatproj:child-run',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'parent-session',
      sessionSequence: 3,
      rootRunId: 'root-1',
      runId: 'child-1',
      sourceEventId: 'child-run',
      sourceSessionId: 'child-session',
      parentRunId: 'root-1',
      parentToolCallId: 'invoke-1',
    });
    // Shared root sequences 3..26 lived on the child session; parent lane jumps to 27.
    const toolFinished = reducer.apply({
      type: 'tool.call.finished',
      protocolVersion: 'narad/v1',
      eventId: 'e-parent-tool-done',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 'parent-session',
      sessionSequence: 4,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 27,
      toolCallId: 'invoke-1',
      outcome: 'success',
      response: { result: '42' },
    });
    expect(toolFinished.applied).toBe(true);
    expect(toolFinished.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(4);
  });

  it('rejects authority parent run.resumed without a prior pause (server must not emit)', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'parent-session',
      sessionSequence: 1,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 1,
    });
    const resumed = reducer.apply({
      type: 'run.resumed',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'parent-session',
      sessionSequence: 2,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 2,
      waitId: 'wait:child-inner',
    });
    expect(resumed.applied).toBe(false);
    expect(resumed.error).toMatch(/paused to resume/i);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(1);
    expect(reducer.getSnapshot().runs.get('root-1')?.state).toBe('running');
  });

  it('applies mis-sequenced nested child run.finished on parent session lane without gap', () => {
    const reducer = createNaradReducer({ sessionId: 'parent-session', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'parent-session',
      sessionSequence: 1,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 1,
    });
    reducer.apply({
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'parent-session',
      sessionSequence: 2,
      rootRunId: 'root-1',
      runId: 'root-1',
      sequence: 2,
      toolCallId: 'invoke-1',
      toolName: 'invoke_agent_roller',
      executor: 'backend',
      args: {},
    });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'aaatproj:child-run',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'parent-session',
      sessionSequence: 3,
      rootRunId: 'root-1',
      runId: 'child-1',
      sourceEventId: 'child-run',
      sourceSessionId: 'child-session',
      parentRunId: 'root-1',
      parentToolCallId: 'invoke-1',
    });
    const childFinished = reducer.apply({
      type: 'run.finished',
      protocolVersion: 'narad/v1',
      eventId: 'child-finish-canonical',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 'parent-session',
      sessionSequence: 4,
      rootRunId: 'root-1',
      runId: 'child-1',
      sequence: 1,
      parentRunId: 'root-1',
      parentToolCallId: 'invoke-1',
    });
    expect(childFinished.applied).toBe(true);
    expect(childFinished.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(4);
    expect(reducer.getSnapshot().runs.get('child-1')?.state).toBe('finished');
  });

  it('skips stale session replays without opening a gap', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    const stale = reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e-stale',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 's1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    expect(stale.applied).toBe(false);
    expect(stale.gap).toBe(false);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
  });

  it('marks graph delta gap when revision is not contiguous', () => {
    const reducer = createNaradReducer({ sessionId: 'session-graph', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 'session-graph',
      sessionSequence: 1,
      rootRunId: 'run-graph',
      runId: 'run-graph',
      sequence: 1,
    });
    reducer.apply({
      type: 'graph.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-graph',
      scope: 'run',
      rootRunId: 'run-graph',
      graphSchemaVersion: 'narad.graph/v1',
      revision: 1,
      sourceRunCursor: { sequence: 1 },
      rootNodeId: 'node-root',
      nodes: [],
      edges: [],
    });
    const result = reducer.apply({
      type: 'graph.delta',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 'session-graph',
      scope: 'run',
      rootRunId: 'run-graph',
      graphSchemaVersion: 'narad.graph/v1',
      baseRevision: 1,
      revision: 3,
      sourceRunCursor: { sequence: 1 },
      patch: [{ op: 'add', path: '/nodes/-', value: { id: 'n1' } }],
    });
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/revision gap/i);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().resyncRequired).toBe(false);
    const graph = reducer.getSnapshot().graphs.get('run:session-graph:run-graph');
    expect(graph?.deltaGap).toBe(true);
    expect(graph?.resyncRequired).toBe(true);
  });

  it('captures terminal usage and timing on RunSnapshot', () => {
    const reducer = createNaradReducer({ sessionId: 's-usage', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's-usage',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    reducer.apply({
      type: 'run.finished',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 's-usage',
      sessionSequence: 2,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 2,
      usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165, elapsedMs: 1500 },
    });
    const run = reducer.getSnapshot().runs.get('r1');
    expect(run?.state).toBe('finished');
    expect(run?.startedAt).toBe('2026-08-05T00:00:00Z');
    expect(run?.completedAt).toBe('2026-08-05T00:00:02Z');
    expect(run?.usage).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
      elapsedMs: 1500,
    });
  });

  it('rejects orphan tool.call.finished without advancing session cursor (packed deny bug)', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    reducer.apply({
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'e2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 's1',
      sessionSequence: 2,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 2,
      toolCallId: 'invoke-1',
      toolName: 'invoke_agent_roller',
      executor: 'backend',
      args: {},
    });
    // Denied sibling finished without its own started — must not advance lastSessionSequence.
    const orphanDeny = reducer.apply({
      type: 'tool.call.finished',
      protocolVersion: 'narad/v1',
      eventId: 'e3',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 's1',
      sessionSequence: 3,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 3,
      toolCallId: 'fetch-1',
      outcome: 'cancelled',
      response: null,
      code: 'denied',
      message: "Tool 'kautuka_web_fetch' was denied by the user.",
    });
    expect(orphanDeny.applied).toBe(false);
    expect(orphanDeny.gap).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(2);
    expect(reducer.getSnapshot().tools.get('invoke-1')?.open).toBe(true);

    const next = reducer.apply({
      type: 'tool.call.finished',
      protocolVersion: 'narad/v1',
      eventId: 'e4',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 's1',
      sessionSequence: 4,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 4,
      toolCallId: 'invoke-1',
      outcome: 'success',
      response: {},
    });
    expect(next.gap).toBe(true);
    expect(reducer.getSnapshot().sessionGap).toBe(true);
    expect(reducer.getSnapshot().tools.get('invoke-1')?.open).toBe(true);
  });

  it('applies packed approve+deny when each toolCallId has start before finish', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    reducer.apply({
      type: 'run.started',
      protocolVersion: 'narad/v1',
      eventId: 'e1',
      timestamp: '2026-08-05T00:00:00Z',
      sessionId: 's1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    for (const [seq, toolCallId, toolName] of [
      [2, 'invoke-1', 'invoke_agent_roller'],
      [3, 'fetch-1', 'kautuka_web_fetch'],
    ] as const) {
      expect(
        reducer.apply({
          type: 'tool.call.started',
          protocolVersion: 'narad/v1',
          eventId: `start-${toolCallId}`,
          timestamp: `2026-08-05T00:00:0${seq}Z`,
          sessionId: 's1',
          sessionSequence: seq,
          rootRunId: 'r1',
          runId: 'r1',
          sequence: seq,
          toolCallId,
          toolName,
          executor: 'backend',
          args: {},
        }).applied,
      ).toBe(true);
    }
    expect(
      reducer.apply({
        type: 'tool.call.finished',
        protocolVersion: 'narad/v1',
        eventId: 'finish-fetch',
        timestamp: '2026-08-05T00:00:04Z',
        sessionId: 's1',
        sessionSequence: 4,
        rootRunId: 'r1',
        runId: 'r1',
        sequence: 4,
        toolCallId: 'fetch-1',
        outcome: 'cancelled',
        response: null,
        code: 'denied',
        message: "Tool 'kautuka_web_fetch' was denied by the user.",
      }).applied,
    ).toBe(true);
    expect(
      reducer.apply({
        type: 'tool.call.finished',
        protocolVersion: 'narad/v1',
        eventId: 'finish-invoke',
        timestamp: '2026-08-05T00:00:05Z',
        sessionId: 's1',
        sessionSequence: 5,
        rootRunId: 'r1',
        runId: 'r1',
        sequence: 5,
        toolCallId: 'invoke-1',
        outcome: 'success',
        response: { result: '84' },
      }).applied,
    ).toBe(true);
    expect(reducer.getSnapshot().sessionGap).toBe(false);
    expect(reducer.getSnapshot().tools.get('fetch-1')?.open).toBe(false);
    expect(reducer.getSnapshot().tools.get('invoke-1')?.open).toBe(false);
    expect(reducer.getSnapshot().lastSessionSequence).toBe(5);
  });

  it('accepts workflow-scope interrupt then consecutive workflow.paused', () => {
    const reducer = createNaradReducer({ sessionId: 'wf-1', activeProfiles: ALL_PROFILES });
    expect(
      reducer.apply({
        type: 'workflow.started',
        protocolVersion: 'narad/v1',
        eventId: 'wf-start',
        timestamp: '2026-08-05T00:00:00Z',
        sessionId: 'wf-1',
        sessionSequence: 1,
        workflowId: 'wf-1',
        workflowSequence: 1,
      }).applied,
    ).toBe(true);
    expect(
      reducer.apply({
        type: 'interrupt.requested',
        protocolVersion: 'narad/v1',
        eventId: 'wf-int',
        timestamp: '2026-08-05T00:00:01Z',
        sessionId: 'wf-1',
        sessionSequence: 2,
        workflowId: 'wf-1',
        workflowSequence: 2,
        scope: 'workflow',
        interruptId: 'wrev-1',
        waitId: 'wait:wrev-1',
        kind: 'workflow_review',
        actions: ['approve', 'request_changes', 'stop_run'],
      }).applied,
    ).toBe(true);
    expect(
      reducer.apply({
        type: 'workflow.paused',
        protocolVersion: 'narad/v1',
        eventId: 'wf-pause',
        timestamp: '2026-08-05T00:00:02Z',
        sessionId: 'wf-1',
        sessionSequence: 3,
        workflowId: 'wf-1',
        workflowSequence: 3,
        waitId: 'wait:wrev-1',
        interruptId: 'wrev-1',
      }).applied,
    ).toBe(true);
    const snapshot = reducer.getSnapshot();
    expect(snapshot.interrupts.get('wrev-1')?.scope).toBe('workflow');
    expect(snapshot.interrupts.get('wrev-1')?.open).toBe(true);
    expect(snapshot.workflows.get('wf-1')?.state).toBe('paused');
    expect(snapshot.workflows.get('wf-1')?.openWaitId).toBe('wait:wrev-1');
  });

  it('rejects interrupt.resolved when decision is not an advertised action', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    expect(
      reducer.apply({
        type: 'run.started',
        protocolVersion: 'narad/v1',
        eventId: 'e1',
        timestamp: '2026-08-05T00:00:00Z',
        sessionId: 's1',
        sessionSequence: 1,
        rootRunId: 'r1',
        runId: 'r1',
        sequence: 1,
      }).applied,
    ).toBe(true);
    expect(
      reducer.apply({
        type: 'interrupt.requested',
        protocolVersion: 'narad/v1',
        eventId: 'e2',
        timestamp: '2026-08-05T00:00:01Z',
        sessionId: 's1',
        sessionSequence: 2,
        rootRunId: 'r1',
        runId: 'r1',
        sequence: 2,
        interruptId: 'apr-1',
        waitId: 'wait:apr-1',
        kind: 'approval',
        actions: ['approve', 'deny'],
      }).applied,
    ).toBe(true);
    expect(
      reducer.apply({
        type: 'run.paused',
        protocolVersion: 'narad/v1',
        eventId: 'e3',
        timestamp: '2026-08-05T00:00:01Z',
        sessionId: 's1',
        sessionSequence: 3,
        rootRunId: 'r1',
        runId: 'r1',
        sequence: 3,
        waitId: 'wait:apr-1',
        reason: 'interrupt',
        resumeMode: 'command',
        interruptId: 'apr-1',
      }).applied,
    ).toBe(true);
    const rejected = reducer.apply({
      type: 'interrupt.resolved',
      protocolVersion: 'narad/v1',
      eventId: 'e4',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 's1',
      sessionSequence: 4,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 4,
      interruptId: 'apr-1',
      waitId: 'wait:apr-1',
      decision: 'approved',
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.error).toBe('Decision is not one of the interrupt actions.');
    expect(reducer.getSnapshot().interrupts.get('apr-1')?.open).toBe(true);
  });

  it('keeps packed interrupt.resolved.members on the snapshot', () => {
    const reducer = createNaradReducer({ sessionId: 's1', activeProfiles: ALL_PROFILES });
    const apply = (event: Record<string, unknown>) => {
      const result = reducer.apply({
        protocolVersion: 'narad/v1',
        sessionId: 's1',
        timestamp: '2026-08-05T00:00:00Z',
        ...event,
      });
      expect(result.applied).toBe(true);
    };
    apply({
      type: 'run.started',
      eventId: 'e1',
      sessionSequence: 1,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 1,
    });
    apply({
      type: 'interrupt.requested',
      eventId: 'e2',
      sessionSequence: 2,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 2,
      interruptId: 'apr-pack',
      waitId: 'wait:apr-pack',
      kind: 'approval',
      actions: ['approve', 'deny'],
      input: {
        members: [
          { requestId: 'apr-pack', toolCallId: 'call-1', toolName: 'invoke_agent_roller' },
          { requestId: 'apr-fetch', toolCallId: 'call-2', toolName: 'kautuka_web_fetch' },
        ],
      },
    });
    apply({
      type: 'run.paused',
      eventId: 'e3',
      sessionSequence: 3,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 3,
      waitId: 'wait:apr-pack',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'apr-pack',
    });
    apply({
      type: 'interrupt.resolved',
      eventId: 'e4',
      sessionSequence: 4,
      rootRunId: 'r1',
      runId: 'r1',
      sequence: 4,
      interruptId: 'apr-pack',
      waitId: 'wait:apr-pack',
      decision: 'deny',
      members: [
        { requestId: 'apr-pack', toolCallId: 'call-1', toolName: 'invoke_agent_roller', decision: 'deny' },
        { requestId: 'apr-fetch', toolCallId: 'call-2', toolName: 'kautuka_web_fetch', decision: 'approve' },
      ],
    });
    const interrupt = reducer.getSnapshot().interrupts.get('apr-pack');
    expect(interrupt?.open).toBe(false);
    expect(interrupt?.decision).toBe('deny');
    expect(interrupt?.members).toEqual([
      { requestId: 'apr-pack', toolCallId: 'call-1', toolName: 'invoke_agent_roller', decision: 'deny' },
      { requestId: 'apr-fetch', toolCallId: 'call-2', toolName: 'kautuka_web_fetch', decision: 'approve' },
    ]);
  });
});
