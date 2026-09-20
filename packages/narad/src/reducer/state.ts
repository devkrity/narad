import type {
  NaradProfileId,
  AttachmentSnapshot,
  ArtifactSnapshot,
  ConversationMessageSnapshot,
  GraphScopeSnapshot,
  InterruptSnapshot,
  ProgressSnapshot,
  ReasoningSnapshot,
  RunSnapshot,
  RunState,
  ScopedStateSnapshot,
  ToolCallSnapshot,
  ViewSnapshot,
  WorkflowSnapshot,
  WorkspaceSessionSnapshot,
  WorkspaceSnapshot,
} from '../types.js';
import type { ValidatedGraphHydrateRecord } from '../validate/hydrate.js';
import type { EventFingerprintEntry } from './dedup.js';

export interface ConversationInternal {
  messages: ConversationMessageSnapshot[];
  messageById: Map<string, number>;
  reasoning: ReasoningSnapshot[];
  coversThroughSessionSequence: number;
}

export interface ReducerInternalState {
  version: number;
  sessionId: string;
  activeProfiles: readonly NaradProfileId[];
  eventFingerprints: Map<string, EventFingerprintEntry>;
  workspaceEventFingerprints: Map<string, EventFingerprintEntry>;
  lastSessionSequence: number;
  sessionGap: boolean;
  resyncRequired: boolean;
  lastError: string | null;
  workflowSequences: Map<string, number>;
  workflowGaps: Map<string, boolean>;
  rootRunSequences: Map<string, number>;
  rootRunGaps: Map<string, boolean>;
  sessionRevision: number | null;
  workflowRevisions: Map<string, number>;
  nodeRevisions: Map<string, number>;
  activeRootRunId: string | null;
  activeWorkflowId: string | null;
  runs: Map<string, RunSnapshot>;
  workflows: Map<string, WorkflowSnapshot>;
  tools: Map<string, ToolCallSnapshot>;
  interrupts: Map<string, InterruptSnapshot>;
  conversation: ConversationInternal;
  reasoningById: Map<string, ReasoningSnapshot>;
  graphs: Map<string, GraphScopeSnapshot>;
  progressByRun: Map<string, Map<string, ProgressSnapshot>>;
  attachments: Map<string, AttachmentSnapshot>;
  artifacts: Map<string, ArtifactSnapshot>;
  scopedState: Map<string, ScopedStateSnapshot>;
  uiState: Map<string, ScopedStateSnapshot>;
  views: Map<string, ViewSnapshot>;
  workspace: WorkspaceSnapshot | null;
  runRevisions: Map<string, number>;
  graphSourceRunCursor: Map<string, number>;
  pendingGraphHydrates: Map<string, ValidatedGraphHydrateRecord[]>;
  graphHydrateFingerprints: Map<string, string>;
  graphResyncRequired: Map<string, boolean>;
  awaitingPauseAfterInterrupt: Map<string, number>;
  awaitingWorkflowPauseAfterInterrupt: Map<string, number>;
}

export function createInitialReducerState(
  sessionId: string,
  activeProfiles: readonly NaradProfileId[],
): ReducerInternalState {
  return {
    version: 0,
    sessionId,
    activeProfiles: [...activeProfiles],
    eventFingerprints: new Map(),
    workspaceEventFingerprints: new Map(),
    lastSessionSequence: 0,
    sessionGap: false,
    resyncRequired: false,
    lastError: null,
    workflowSequences: new Map(),
    workflowGaps: new Map(),
    rootRunSequences: new Map(),
    rootRunGaps: new Map(),
    sessionRevision: null,
    workflowRevisions: new Map(),
    nodeRevisions: new Map(),
    activeRootRunId: null,
    activeWorkflowId: null,
    runs: new Map(),
    workflows: new Map(),
    tools: new Map(),
    interrupts: new Map(),
    conversation: {
      messages: [],
      messageById: new Map(),
      reasoning: [],
      coversThroughSessionSequence: 0,
    },
    reasoningById: new Map(),
    graphs: new Map(),
    progressByRun: new Map(),
    attachments: new Map(),
    artifacts: new Map(),
    scopedState: new Map(),
    uiState: new Map(),
    views: new Map(),
    workspace: null,
    runRevisions: new Map(),
    graphSourceRunCursor: new Map(),
    pendingGraphHydrates: new Map(),
    graphHydrateFingerprints: new Map(),
    graphResyncRequired: new Map(),
    awaitingPauseAfterInterrupt: new Map(),
    awaitingWorkflowPauseAfterInterrupt: new Map(),
  };
}

export function cloneMapWithEntry<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

export function upsertConversationMessage(
  state: ReducerInternalState,
  next: ConversationMessageSnapshot,
): void {
  const existingIndex = state.conversation.messageById.get(next.messageId);
  if (existingIndex === undefined) {
    state.conversation.messages.push(next);
    state.conversation.messageById.set(next.messageId, state.conversation.messages.length - 1);
    return;
  }
  const copy = state.conversation.messages.slice();
  copy[existingIndex] = next;
  state.conversation.messages = copy;
}

export function syncConversationReasoning(state: ReducerInternalState): void {
  state.conversation.reasoning = [...state.reasoningById.values()];
}

export function terminalRunState(type: string): RunState | null {
  if (type === 'run.finished') return 'finished';
  if (type === 'run.error') return 'error';
  if (type === 'run.cancelled') return 'cancelled';
  return null;
}

export function workflowTerminalState(type: string): WorkflowSnapshot['state'] | null {
  if (type === 'workflow.finished') return 'finished';
  if (type === 'workflow.error') return 'error';
  if (type === 'workflow.cancelled') return 'cancelled';
  return null;
}

export function graphScopeKey(scope: string, sessionId: string, rootRunId?: string, workflowId?: string): string {
  if (scope === 'run') {
    return `run:${sessionId}:${rootRunId ?? ''}`;
  }
  return `workflow:${sessionId}:${workflowId ?? ''}`;
}

export function stateScopeKey(
  scope: string,
  sessionId: string,
  workflowId?: string,
  rootRunId?: string,
  runId?: string,
): string {
  if (scope === 'session') return `session:${sessionId}`;
  if (scope === 'workflow') return `workflow:${sessionId}:${workflowId ?? ''}`;
  return `run:${sessionId}:${rootRunId ?? ''}:${runId ?? ''}`;
}

export function upsertWorkspaceSession(
  sessions: readonly WorkspaceSessionSnapshot[],
  sessionId: string,
  archived: boolean,
): WorkspaceSessionSnapshot[] {
  const index = sessions.findIndex((session) => session.sessionId === sessionId);
  if (index === -1) {
    return [...sessions, { sessionId, archived }];
  }
  const copy = sessions.slice();
  copy[index] = { sessionId, archived };
  return copy;
}

export function markReducerFailure(
  state: ReducerInternalState,
  error: string,
  gap = false,
): void {
  state.lastError = error;
  if (gap) {
    state.sessionGap = true;
  }
}
