import type { NaradSessionSnapshot } from '../types.js';
import type { ReducerInternalState } from './state.js';
import { NARAD_PROTOCOL_VERSION } from '../types.js';

function freezeMap<K, V>(map: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return map as ReadonlyMap<K, V>;
}

function freezeNestedProgress(
  map: ReadonlyMap<string, ReadonlyMap<string, import('../types.js').ProgressSnapshot>>,
): ReadonlyMap<string, ReadonlyMap<string, import('../types.js').ProgressSnapshot>> {
  const outer = new Map<string, ReadonlyMap<string, import('../types.js').ProgressSnapshot>>();
  for (const [runId, inner] of map.entries()) {
    outer.set(runId, freezeMap(inner));
  }
  return freezeMap(outer);
}

export class SnapshotCache {
  private cachedVersion = -1;
  private cachedSnapshot: NaradSessionSnapshot | null = null;

  getSnapshot(state: ReducerInternalState): NaradSessionSnapshot {
    if (this.cachedSnapshot && this.cachedVersion === state.version) {
      return this.cachedSnapshot;
    }
    this.cachedSnapshot = {
      sessionId: state.sessionId,
      protocolVersion: NARAD_PROTOCOL_VERSION,
      activeProfiles: state.activeProfiles,
      lastSessionSequence: state.lastSessionSequence,
      sessionRevision: state.sessionRevision,
      sessionGap: state.sessionGap,
      resyncRequired: state.resyncRequired,
      lastError: state.lastError,
      activeRootRunId: state.activeRootRunId,
      activeWorkflowId: state.activeWorkflowId,
      runs: freezeMap(state.runs),
      workflows: freezeMap(state.workflows),
      tools: freezeMap(state.tools),
      interrupts: freezeMap(state.interrupts),
      conversation: {
        messages: state.conversation.messages,
        reasoning: state.conversation.reasoning,
        coversThroughSessionSequence: state.conversation.coversThroughSessionSequence,
      },
      graphs: freezeMap(state.graphs),
      progressByRun: freezeNestedProgress(state.progressByRun),
      attachments: freezeMap(state.attachments),
      artifacts: freezeMap(state.artifacts),
      scopedState: freezeMap(state.scopedState),
      uiState: freezeMap(state.uiState),
      views: freezeMap(state.views),
      workspace: state.workspace,
      runRevisions: freezeMap(state.runRevisions),
      workflowRevisions: freezeMap(state.workflowRevisions),
      nodeRevisions: freezeMap(state.nodeRevisions),
      workflowGaps: freezeMap(state.workflowGaps),
      rootRunGaps: freezeMap(state.rootRunGaps),
    };
    this.cachedVersion = state.version;
    return this.cachedSnapshot;
  }

  invalidate(): void {
    this.cachedVersion = -1;
    this.cachedSnapshot = null;
  }
}

export function bumpStateVersion(state: ReducerInternalState): void {
  state.version += 1;
}
