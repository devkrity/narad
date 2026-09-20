import { applySafeJsonPatch, parseJsonPatchOperations } from '../jsonPatch.js';
import { NaradClientError } from '../security.js';
import type { NaradLimits, ReducerApplyResult } from '../types.js';
import type { ValidatedGraphHydrateRecord } from '../validate/hydrate.js';
import { canonicalEventFingerprint } from './dedup.js';
import { bumpStateVersion } from './snapshotCache.js';
import { cloneMapWithEntry, graphScopeKey, type ReducerInternalState } from './state.js';

function success(state: ReducerInternalState): ReducerApplyResult {
  bumpStateVersion(state);
  state.lastError = null;
  return { applied: true, duplicate: false, gap: false, resyncRequired: state.resyncRequired };
}

function duplicate(): ReducerApplyResult {
  return { applied: false, duplicate: true, gap: false, resyncRequired: false };
}

function rejected(state: ReducerInternalState, error: string, graphResyncKey?: string): ReducerApplyResult {
  state.lastError = error;
  if (graphResyncKey) {
    markGraphResync(state, graphResyncKey, error);
  }
  bumpStateVersion(state);
  return { applied: false, duplicate: false, gap: false, resyncRequired: state.resyncRequired, error };
}

function buffered(): ReducerApplyResult {
  return { applied: false, duplicate: false, gap: false, resyncRequired: false };
}

function graphHydrateFingerprintKey(scopeKey: string, revision: number, type: string): string {
  return `${scopeKey}:r${revision}:${type}`;
}

function graphScopeKeyForRecord(state: ReducerInternalState, record: ValidatedGraphHydrateRecord): string {
  const scope = String(record.scope);
  return graphScopeKey(
    scope,
    String(record.sessionId),
    typeof record.rootRunId === 'string' ? record.rootRunId : undefined,
    typeof record.workflowId === 'string' ? record.workflowId : undefined,
  );
}

function sourceRunCursorSequence(record: ValidatedGraphHydrateRecord): number | undefined {
  if (record.scope !== 'run' || !record.sourceRunCursor || typeof record.sourceRunCursor !== 'object') {
    return undefined;
  }
  return Number((record.sourceRunCursor as Record<string, unknown>).sequence);
}

function authorityRunSequence(state: ReducerInternalState, rootRunId: string): number {
  let max = state.rootRunSequences.get(rootRunId) ?? 0;
  for (const run of state.runs.values()) {
    if (run.rootRunId === rootRunId) {
      max = Math.max(max, run.lastSequence ?? 0);
    }
  }
  return max;
}

function markGraphResync(state: ReducerInternalState, scopeKey: string, error: string): void {
  state.graphResyncRequired.set(scopeKey, true);
  state.lastError = error;
  const existing = state.graphs.get(scopeKey);
  if (existing) {
    state.graphs = cloneMapWithEntry(state.graphs, scopeKey, {
      ...existing,
      resyncRequired: true,
    });
  }
}

function checkGraphHydrateIdentity(
  state: ReducerInternalState,
  scopeKey: string,
  revision: number,
  type: string,
  record: ValidatedGraphHydrateRecord,
): 'new' | 'duplicate' | 'conflict' {
  const key = graphHydrateFingerprintKey(scopeKey, revision, type);
  const fingerprint = canonicalEventFingerprint(record);
  const existing = state.graphHydrateFingerprints.get(key);
  if (!existing) {
    return 'new';
  }
  if (existing === fingerprint) {
    return 'duplicate';
  }
  return 'conflict';
}

function commitGraphHydrateIdentity(
  state: ReducerInternalState,
  scopeKey: string,
  revision: number,
  type: string,
  record: ValidatedGraphHydrateRecord,
): void {
  const key = graphHydrateFingerprintKey(scopeKey, revision, type);
  state.graphHydrateFingerprints.set(key, canonicalEventFingerprint(record));
}

function enqueuePendingGraphHydrate(
  state: ReducerInternalState,
  scopeKey: string,
  record: ValidatedGraphHydrateRecord,
  limits: NaradLimits,
): ReducerApplyResult {
  const queue = state.pendingGraphHydrates.get(scopeKey) ?? [];
  if (queue.length >= limits.maxPendingQueue) {
    return rejected(state, 'Graph hydrate buffer overflow requires resync.', scopeKey);
  }
  state.pendingGraphHydrates.set(scopeKey, [...queue, record]);
  return buffered();
}

/**
 * Graph revisions are a total order per scope. Never apply a later hydrate while an
 * earlier one is still buffered (e.g. awaiting authority sourceRunCursor) — that jumps
 * baseRevision and invents "Graph revision gap requires resync."
 */
function hasPendingGraphHydrates(state: ReducerInternalState, scopeKey: string): boolean {
  const queue = state.pendingGraphHydrates.get(scopeKey);
  return queue !== undefined && queue.length > 0;
}

function clearPendingGraphHydrates(state: ReducerInternalState, scopeKey: string): void {
  state.pendingGraphHydrates.delete(scopeKey);
}

function applyGraphSnapshot(
  state: ReducerInternalState,
  record: ValidatedGraphHydrateRecord,
  scopeKey: string,
): void {
  const scope = String(record.scope);
  const sessionId = String(record.sessionId);
  const sourceSequence = sourceRunCursorSequence(record);
  const previousCursor = state.graphSourceRunCursor.get(scopeKey);
  if (scope === 'run' && previousCursor !== undefined && sourceSequence !== undefined && sourceSequence < previousCursor) {
    throw new NaradClientError('graph_cursor_regress', 'Graph source run cursor regressed.');
  }
  const existing = state.graphs.get(scopeKey);
  const revision = Number(record.revision);
  if (existing && revision < existing.revision) {
    throw new NaradClientError('graph_revision_regress', 'Graph snapshot revision regressed.');
  }
  if (sourceSequence !== undefined) {
    state.graphSourceRunCursor.set(scopeKey, sourceSequence);
  }
  // Snapshot is a new total order - drop stale queued deltas that cannot chain to it.
  clearPendingGraphHydrates(state, scopeKey);
  state.graphs = cloneMapWithEntry(state.graphs, scopeKey, {
    scope: scope as 'run' | 'workflow',
    scopeKey,
    sessionId,
    rootRunId: typeof record.rootRunId === 'string' ? record.rootRunId : undefined,
    workflowId: typeof record.workflowId === 'string' ? record.workflowId : undefined,
    graphSchemaVersion: String(record.graphSchemaVersion),
    revision,
    sourceRunCursorSequence: sourceSequence,
    rootNodeId: String(record.rootNodeId),
    nodes: Array.isArray(record.nodes) ? record.nodes : [],
    edges: Array.isArray(record.edges) ? record.edges : [],
    deltaGap: false,
    resyncRequired: false,
  });
  state.graphResyncRequired.delete(scopeKey);
}

function applyGraphDelta(
  state: ReducerInternalState,
  record: ValidatedGraphHydrateRecord,
  scopeKey: string,
  fromBuffer: boolean,
): 'applied' | 'revision_gap' {
  const existing = state.graphs.get(scopeKey);
  if (!existing) {
    throw new NaradClientError('invalid_graph_hydrate', 'Graph delta requires an existing snapshot.');
  }
  const baseRevision = Number(record.baseRevision);
  const revision = Number(record.revision);
  if (existing.revision !== baseRevision || revision !== baseRevision + 1) {
    state.graphs = cloneMapWithEntry(state.graphs, scopeKey, {
      ...existing,
      deltaGap: true,
      resyncRequired: true,
    });
    state.graphResyncRequired.set(scopeKey, true);
    return 'revision_gap';
  }
  const sourceSequence = sourceRunCursorSequence(record);
  const previousCursor = state.graphSourceRunCursor.get(scopeKey);
  // Live stream: source cursor must not regress across increasing revisions.
  // Buffered tails may carry the cursor from emit time while an earlier
  // revision was still waiting on a higher cursor (FIFO, not leapfrog).
  if (
    !fromBuffer &&
    previousCursor !== undefined &&
    sourceSequence !== undefined &&
    sourceSequence < previousCursor
  ) {
    throw new NaradClientError('graph_cursor_regress', 'Graph source run cursor regressed.');
  }
  if (sourceSequence !== undefined) {
    state.graphSourceRunCursor.set(
      scopeKey,
      previousCursor === undefined ? sourceSequence : Math.max(previousCursor, sourceSequence),
    );
  }
  const patch = parseJsonPatchOperations(record.patch);
  const patched = applySafeJsonPatch(
    { rootNodeId: existing.rootNodeId, nodes: existing.nodes, edges: existing.edges },
    patch,
  );
  state.graphs = cloneMapWithEntry(state.graphs, scopeKey, {
    ...existing,
    revision,
    rootNodeId: typeof patched.rootNodeId === 'string' ? patched.rootNodeId : existing.rootNodeId,
    nodes: Array.isArray(patched.nodes) ? patched.nodes : existing.nodes,
    edges: Array.isArray(patched.edges) ? patched.edges : existing.edges,
    sourceRunCursorSequence: state.graphSourceRunCursor.get(scopeKey) ?? existing.sourceRunCursorSequence,
    deltaGap: false,
    resyncRequired: false,
  });
  state.graphResyncRequired.delete(scopeKey);
  return 'applied';
}

function canApplyRunScopedGraph(
  state: ReducerInternalState,
  record: ValidatedGraphHydrateRecord,
  rootRunId: string,
): 'ready' | 'buffer' | 'reject' {
  if (!state.runs.has(rootRunId)) {
    return 'reject';
  }
  const sourceSequence = sourceRunCursorSequence(record);
  if (sourceSequence === undefined) {
    return 'ready';
  }
  const authoritySequence = authorityRunSequence(state, rootRunId);
  if (sourceSequence > authoritySequence) {
    return 'buffer';
  }
  return 'ready';
}

function canApplyWorkflowScopedGraph(
  state: ReducerInternalState,
  record: ValidatedGraphHydrateRecord,
): 'ready' | 'reject' {
  const workflowId = String(record.workflowId);
  if (!state.workflows.has(workflowId)) {
    return 'reject';
  }
  return 'ready';
}

function applyGraphHydrateNow(
  state: ReducerInternalState,
  record: ValidatedGraphHydrateRecord,
  scopeKey: string,
  limits: NaradLimits,
  fromBuffer = false,
): ReducerApplyResult {
  // After a gap, further deltas only spam; resync already required for this scope.
  if (state.graphResyncRequired.get(scopeKey) && record.type === 'graph.delta') {
    clearPendingGraphHydrates(state, scopeKey);
    return {
      applied: false,
      duplicate: false,
      gap: false,
      resyncRequired: true,
      // Omit error so debug log does not thrash console.error on every later delta.
    };
  }

  const revision = Number(record.revision);
  const identity = checkGraphHydrateIdentity(state, scopeKey, revision, String(record.type), record);
  if (identity === 'duplicate') {
    return duplicate();
  }
  if (identity === 'conflict') {
    return rejected(state, 'Conflicting graph hydrate for the same revision.', scopeKey);
  }
  try {
    if (record.type === 'graph.snapshot') {
      applyGraphSnapshot(state, record, scopeKey);
    } else {
      const outcome = applyGraphDelta(state, record, scopeKey, fromBuffer);
      if (outcome === 'revision_gap') {
        clearPendingGraphHydrates(state, scopeKey);
        return rejected(state, 'Graph revision gap requires resync.', scopeKey);
      }
    }
  } catch (error) {
    const message = error instanceof NaradClientError ? error.message : 'Graph hydrate rejected.';
    return rejected(state, message, scopeKey);
  }
  commitGraphHydrateIdentity(state, scopeKey, revision, String(record.type), record);
  return success(state);
}

export function applyGraphHydrateRecordToState(
  state: ReducerInternalState,
  record: ValidatedGraphHydrateRecord,
  limits: NaradLimits,
): ReducerApplyResult {
  if (record.sessionId !== state.sessionId) {
    return rejected(state, 'Graph hydrate session mismatch.');
  }

  const scopeKey = graphScopeKeyForRecord(state, record);
  const scope = String(record.scope);

  if (scope === 'run') {
    const rootRunId = String(record.rootRunId);
    const readiness = canApplyRunScopedGraph(state, record, rootRunId);
    if (readiness === 'reject') {
      return rejected(state, 'Graph run scope references unknown root run.', scopeKey);
    }
    // Snapshots reset the revision lane (and clear pending). Deltas stay FIFO so a later
    // ready cursor never leaps over an earlier buffered revision.
    if (record.type === 'graph.delta' && (readiness === 'buffer' || hasPendingGraphHydrates(state, scopeKey))) {
      return enqueuePendingGraphHydrate(state, scopeKey, record, limits);
    }
  } else {
    const readiness = canApplyWorkflowScopedGraph(state, record);
    if (readiness === 'reject') {
      return rejected(state, 'Graph workflow scope references unknown workflow.', scopeKey);
    }
    if (record.type === 'graph.delta' && hasPendingGraphHydrates(state, scopeKey)) {
      return enqueuePendingGraphHydrate(state, scopeKey, record, limits);
    }
  }

  return applyGraphHydrateNow(state, record, scopeKey, limits);
}

export function drainPendingGraphHydrates(
  state: ReducerInternalState,
  rootRunId: string,
  limits: NaradLimits,
): void {
  for (const [scopeKey, queue] of [...state.pendingGraphHydrates.entries()]) {
    if (!scopeKey.includes(`:${rootRunId}`)) {
      continue;
    }
    if (queue.length === 0) {
      continue;
    }
    const remaining: ValidatedGraphHydrateRecord[] = [];
    for (let index = 0; index < queue.length; index += 1) {
      const record = queue[index]!;
      const readiness = canApplyRunScopedGraph(state, record, rootRunId);
      if (readiness === 'buffer') {
        // Stop: later revisions must wait behind this head.
        remaining.push(...queue.slice(index));
        break;
      }
      if (readiness === 'reject') {
        markGraphResync(state, scopeKey, 'Graph hydrate references unknown root run.');
        remaining.length = 0;
        break;
      }
      applyGraphHydrateNow(state, record, scopeKey, limits, true);
    }
    if (remaining.length === 0) {
      state.pendingGraphHydrates.delete(scopeKey);
    } else {
      state.pendingGraphHydrates.set(scopeKey, remaining);
    }
  }
}
