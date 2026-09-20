import { describe, expect, it } from 'vitest';
import { createNaradReducer } from './reducer/index.js';
import { NARAD_PROFILE_IDS } from './types.js';
import { validateHydrateRecord } from './validate/hydrate.js';
import { DEFAULT_NARAD_LIMITS } from './types.js';
import { NaradClientError } from './security.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

describe('graph hydrate records', () => {
  it('classifies graph records as hydrate without authority fields', () => {
    expect(() =>
      validateHydrateRecord(
        {
          type: 'graph.snapshot',
          protocolVersion: 'narad/v1',
          timestamp: '2026-08-05T00:00:00Z',
          sessionId: 'session-graph',
          sessionSequence: 2,
          scope: 'run',
          rootRunId: 'run-graph',
          graphSchemaVersion: 'narad.graph/v1',
          revision: 1,
          sourceRunCursor: { sequence: 1 },
          rootNodeId: 'node-root',
          nodes: [],
          edges: [],
        },
        DEFAULT_NARAD_LIMITS,
        ALL_PROFILES,
      ),
    ).toThrow(NaradClientError);
  });

  it('buffers run-scoped graph hydrate until authority catches up', () => {
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
    const buffered = reducer.apply({
      type: 'graph.delta',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 'session-graph',
      scope: 'run',
      rootRunId: 'run-graph',
      graphSchemaVersion: 'narad.graph/v1',
      baseRevision: 1,
      revision: 2,
      sourceRunCursor: { sequence: 2 },
      patch: [{ op: 'add', path: '/nodes/-', value: { id: 'n1' } }],
    });
    expect(buffered.applied).toBe(false);
    expect(buffered.error).toBeUndefined();
    reducer.apply({
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-3',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'session-graph',
      sessionSequence: 2,
      rootRunId: 'run-graph',
      runId: 'run-graph',
      sequence: 2,
      toolCallId: 'tool-1',
      toolName: 'search',
      executor: 'backend',
      args: {},
    });
    const graph = reducer.getSnapshot().graphs.get('run:session-graph:run-graph');
    expect(graph?.revision).toBe(2);
  });

  it('ignores deterministic duplicate graph hydrate records', () => {
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
    const snapshot = {
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
    };
    reducer.apply(snapshot);
    const first = reducer.getSnapshot();
    const duplicate = reducer.apply(snapshot);
    expect(duplicate.duplicate).toBe(true);
    expect(reducer.getSnapshot()).toBe(first);
  });

  it('buffers trailing graph deltas behind a high sourceRunCursor head (no revision leapfrog)', () => {
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
      nodes: [{ id: 'node-root', label: 'Run', status: 'running' }],
      edges: [],
    });
    // Head waits for authority sequence 4.
    expect(
      reducer.apply({
        type: 'graph.delta',
        protocolVersion: 'narad/v1',
        timestamp: '2026-08-05T00:00:02Z',
        sessionId: 'session-graph',
        scope: 'run',
        rootRunId: 'run-graph',
        graphSchemaVersion: 'narad.graph/v1',
        baseRevision: 1,
        revision: 2,
        sourceRunCursor: { sequence: 4 },
        patch: [{ op: 'replace', path: '/nodes/0/status', value: 'waiting' }],
      }).applied,
    ).toBe(false);
    // Tail is already runnable on authority (cursor 1) but must not leapfrog head.
    expect(
      reducer.apply({
        type: 'graph.delta',
        protocolVersion: 'narad/v1',
        timestamp: '2026-08-05T00:00:03Z',
        sessionId: 'session-graph',
        scope: 'run',
        rootRunId: 'run-graph',
        graphSchemaVersion: 'narad.graph/v1',
        baseRevision: 2,
        revision: 3,
        sourceRunCursor: { sequence: 1 },
        patch: [{ op: 'replace', path: '/nodes/0/status', value: 'running' }],
      }).error,
    ).toBeUndefined();
    expect(reducer.getSnapshot().graphs.get('run:session-graph:run-graph')?.revision).toBe(1);
    expect(reducer.getSnapshot().graphs.get('run:session-graph:run-graph')?.deltaGap).toBeFalsy();

    for (const sequence of [2, 3, 4]) {
      const result = reducer.apply({
        type: 'progress.recorded',
        protocolVersion: 'narad/v1',
        eventId: `evt-${sequence}`,
        timestamp: `2026-08-05T00:00:0${sequence}Z`,
        sessionId: 'session-graph',
        sessionSequence: sequence,
        rootRunId: 'run-graph',
        runId: 'run-graph',
        sequence,
        progressId: `progress-${sequence}`,
        category: 'runtime',
        label: `step-${sequence}`,
        status: 'active',
        privacy: 'public',
      });
      expect(result.applied, `progress seq ${sequence}: ${result.error}`).toBe(true);
    }

    const graph = reducer.getSnapshot().graphs.get('run:session-graph:run-graph');
    expect(graph?.revision).toBe(3);
    expect(graph?.deltaGap).toBe(false);
    expect(graph?.resyncRequired).toBe(false);
  });

  it('rejects a live graph.delta whose sourceRunCursor regresses', () => {
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
      type: 'tool.call.started',
      protocolVersion: 'narad/v1',
      eventId: 'evt-2',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-graph',
      sessionSequence: 2,
      rootRunId: 'run-graph',
      runId: 'run-graph',
      sequence: 2,
      toolCallId: 'tool-1',
      toolName: 'search',
      executor: 'backend',
      args: {},
    });
    reducer.apply({
      type: 'graph.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:02Z',
      sessionId: 'session-graph',
      scope: 'run',
      rootRunId: 'run-graph',
      graphSchemaVersion: 'narad.graph/v1',
      revision: 1,
      sourceRunCursor: { sequence: 2 },
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
      revision: 2,
      sourceRunCursor: { sequence: 1 },
      patch: [{ op: 'add', path: '/nodes/-', value: { id: 'node-tool-1' } }],
    });
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/cursor regressed/i);
    expect(reducer.getSnapshot().graphs.get('run:session-graph:run-graph')?.revision).toBe(1);
  });

  it('applies full /nodes replace status deltas without index paths', () => {
    const reducer = createNaradReducer({ sessionId: 'session-graph', activeProfiles: ALL_PROFILES });
    const base = {
      protocolVersion: 'narad/v1' as const,
      sessionId: 'session-graph',
      rootRunId: 'run-graph',
      runId: 'run-graph',
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
      interruptId: 'a1',
      waitId: 'wait:a1',
      kind: 'approval',
      actions: ['approve'],
    });
    reducer.apply({
      ...base,
      type: 'run.paused',
      eventId: 'evt-2b',
      timestamp: '2026-08-05T00:00:01Z',
      sessionSequence: 3,
      sequence: 3,
      waitId: 'wait:a1',
      reason: 'interrupt',
      resumeMode: 'command',
      interruptId: 'a1',
    });
    reducer.apply({
      type: 'graph.snapshot',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:01Z',
      sessionId: 'session-graph',
      scope: 'run',
      rootRunId: 'run-graph',
      graphSchemaVersion: 'narad.graph/v1',
      revision: 2,
      sourceRunCursor: { sequence: 2 },
      rootNodeId: 'node-root',
      nodes: [
        { id: 'node-root', nodeId: 'node-root', label: 'Run', status: 'waiting', kind: 'run' },
        { id: 'node-interrupt-a1', nodeId: 'node-interrupt-a1', label: 'Approval', status: 'waiting', kind: 'approval' },
      ],
      edges: [],
    });
    const delta = reducer.apply({
      type: 'graph.delta',
      protocolVersion: 'narad/v1',
      timestamp: '2026-08-05T00:00:03Z',
      sessionId: 'session-graph',
      scope: 'run',
      rootRunId: 'run-graph',
      graphSchemaVersion: 'narad.graph/v1',
      baseRevision: 2,
      revision: 3,
      sourceRunCursor: { sequence: 4 },
      patch: [
        {
          op: 'replace',
          path: '/nodes',
          value: [
            { id: 'node-root', nodeId: 'node-root', label: 'Run', status: 'waiting', kind: 'run' },
            {
              id: 'node-interrupt-a1',
              nodeId: 'node-interrupt-a1',
              label: 'Approval',
              status: 'completed',
              kind: 'approval',
            },
          ],
        },
      ],
    });
    expect(delta.applied).toBe(false);
    expect(delta.error).toBeUndefined();
    const resolved = reducer.apply({
      ...base,
      type: 'interrupt.resolved',
      eventId: 'evt-3',
      timestamp: '2026-08-05T00:00:03Z',
      sessionSequence: 4,
      sequence: 4,
      interruptId: 'a1',
      waitId: 'wait:a1',
      decision: 'approve',
    });
    expect(resolved.applied).toBe(true);
    const graph = reducer.getSnapshot().graphs.get('run:session-graph:run-graph');
    expect(graph?.revision).toBe(3);
    expect(graph?.resyncRequired).toBe(false);
    const approval = (graph?.nodes as Array<Record<string, unknown>> | undefined)?.find(
      (node) => node.id === 'node-interrupt-a1',
    );
    expect(approval?.status).toBe('completed');
  });

  it('requires narad.graph/v1 profile', () => {
    expect(() =>
      validateHydrateRecord(
        {
          type: 'graph.snapshot',
          protocolVersion: 'narad/v1',
          timestamp: '2026-08-05T00:00:00Z',
          sessionId: 'session-graph',
          scope: 'run',
          rootRunId: 'run-graph',
          graphSchemaVersion: 'narad.graph/v1',
          revision: 1,
          sourceRunCursor: { sequence: 1 },
          rootNodeId: 'node-root',
          nodes: [],
          edges: [],
        },
        DEFAULT_NARAD_LIMITS,
        ALL_PROFILES.filter((profile) => profile !== NARAD_PROFILE_IDS.graph),
      ),
    ).toThrow(NaradClientError);
  });
});
