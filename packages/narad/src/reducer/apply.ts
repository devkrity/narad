import { applySafeJsonPatch, parseJsonPatchOperations } from '../jsonPatch.js';
import { NaradClientError } from '../security.js';
import type {
  NaradLimits,
  ConversationMessageSnapshot,
  InterruptMemberSnapshot,
  ReducerApplyResult,
  RunUsage,
} from '../types.js';
import type { ValidatedHydrateRecord } from '../validate/hydrate.js';
import {
  checkEventIdentity,
  commitEventFingerprint,
  sessionDedupKey,
  workspaceDedupKey,
} from './dedup.js';
import { validateAuthoritySemantics, validateWatchSemantics } from './guards.js';
import { applyGraphHydrateRecordToState, drainPendingGraphHydrates } from './graphHydrate.js';
import { bumpStateVersion } from './snapshotCache.js';
import {
  cloneMapWithEntry,
  markReducerFailure,
  stateScopeKey,
  syncConversationReasoning,
  terminalRunState,
  upsertConversationMessage,
  upsertWorkspaceSession,
  workflowTerminalState,
  type ReducerInternalState,
} from './state.js';

function readEventTimestamp(event: Record<string, unknown>): string | undefined {
  return typeof event.timestamp === 'string' ? event.timestamp : undefined;
}

function readEventSessionSequence(event: Record<string, unknown>): number | undefined {
  return typeof event.sessionSequence === 'number' ? event.sessionSequence : undefined;
}

function readEventRootRunId(
  state: ReducerInternalState,
  event: Record<string, unknown>,
): string | undefined {
  if (typeof event.rootRunId === 'string') {
    return event.rootRunId;
  }
  if (typeof event.runId === 'string') {
    return state.runs.get(event.runId)?.rootRunId;
  }
  return state.activeRootRunId ?? undefined;
}

function readEventRunId(event: Record<string, unknown>): string | undefined {
  return typeof event.runId === 'string' ? event.runId : undefined;
}

function conversationPresentationFields(
  state: ReducerInternalState,
  event: Record<string, unknown>,
): Pick<
  ConversationMessageSnapshot,
  'timestamp' | 'sessionSequence' | 'rootRunId' | 'runId'
> {
  return {
    timestamp: readEventTimestamp(event),
    sessionSequence: readEventSessionSequence(event),
    rootRunId: readEventRootRunId(state, event),
    runId: readEventRunId(event),
  };
}

function skip(state: ReducerInternalState): ReducerApplyResult {
  return {
    applied: false,
    duplicate: false,
    gap: false,
    resyncRequired: state.resyncRequired,
  };
}

function success(state: ReducerInternalState): ReducerApplyResult {
  bumpStateVersion(state);
  state.lastError = null;
  return { applied: true, duplicate: false, gap: false, resyncRequired: state.resyncRequired };
}

function duplicate(): ReducerApplyResult {
  return { applied: false, duplicate: true, gap: false, resyncRequired: false };
}

function gap(state: ReducerInternalState, error: string): ReducerApplyResult {
  markReducerFailure(state, error, true);
  bumpStateVersion(state);
  return { applied: false, duplicate: false, gap: true, resyncRequired: state.resyncRequired, error };
}

function rejected(state: ReducerInternalState, error: string, setGap = false): ReducerApplyResult {
  markReducerFailure(state, error, setGap);
  bumpStateVersion(state);
  return { applied: false, duplicate: false, gap: setGap, resyncRequired: state.resyncRequired, error };
}

function preflightSessionAuthority(
  state: ReducerInternalState,
  event: Record<string, unknown>,
  limits: NaradLimits,
): ReducerApplyResult | 'ok' {
  if (state.sessionGap) {
    return gap(state, 'Session gap active.');
  }
  const eventSessionId = typeof event.sessionId === 'string' ? event.sessionId : null;
  if (eventSessionId !== null && eventSessionId !== state.sessionId) {
    return skip(state);
  }
  const sessionSequence = Number(event.sessionSequence);
  const eventId = String(event.eventId);
  const dedupKey = sessionDedupKey(state.sessionId, eventId);
  try {
    const identity = checkEventIdentity(state.eventFingerprints, dedupKey, eventId, event, sessionSequence, limits);
    if (identity === 'duplicate') {
      return duplicate();
    }
  } catch (error) {
    markReducerFailure(state, error instanceof NaradClientError ? error.message : 'Event identity conflict.', true);
    bumpStateVersion(state);
    return {
      applied: false,
      duplicate: false,
      gap: true,
      resyncRequired: state.resyncRequired,
      error: state.lastError ?? undefined,
    };
  }
  if (sessionSequence <= state.lastSessionSequence) {
    return skip(state);
  }
  const nextAfterAuthority = state.lastSessionSequence + 1;
  // messages.snapshot is not authority; it only covers transcript through N.
  // A fresh reducer (cursor 0) may continue at N+1 without replaying 1..N.
  const snapshotCovered = state.conversation.coversThroughSessionSequence;
  const nextAfterSnapshot =
    state.lastSessionSequence === 0 && snapshotCovered > 0 ? snapshotCovered + 1 : nextAfterAuthority;
  if (sessionSequence !== nextAfterAuthority && sessionSequence !== nextAfterSnapshot) {
    return gap(state, 'Session sequence gap detected.');
  }
  if (typeof event.workflowId === 'string' && typeof event.workflowSequence === 'number') {
    const last = state.workflowSequences.get(event.workflowId) ?? 0;
    if (event.workflowSequence !== last + 1) {
      state.workflowGaps.set(event.workflowId, true);
      return gap(state, 'Workflow sequence gap detected.');
    }
  }
  // Session attach is not the root journal. Nested AAAT child events consume shared
  // root-tree sequence numbers on the child session, so this lane's observed root
  // sequences are intentionally non-contiguous. Contiguity is a root-journal concern.
  return 'ok';
}

function readOptionalRunSequence(event: Record<string, unknown>): number | undefined {
  return typeof event.sequence === 'number' ? event.sequence : undefined;
}

function isParentConversationProjection(event: Record<string, unknown>): boolean {
  return typeof event.sourceEventId === 'string' && event.sourceEventId.length > 0;
}

/** AAAT child rows on the parent session lane are not canonical root run-tree authority. */
function isSessionLaneNestedRunFact(event: Record<string, unknown>): boolean {
  if (isParentConversationProjection(event)) {
    return true;
  }
  const rootRunId = typeof event.rootRunId === 'string' ? event.rootRunId : undefined;
  const runId = typeof event.runId === 'string' ? event.runId : undefined;
  return rootRunId !== undefined && runId !== undefined && runId !== rootRunId;
}

/** Track highest observed root sequence for graph hydrate; never used for session gaps. */
function noteObservedRootRunSequence(state: ReducerInternalState, event: Record<string, unknown>): void {
  if (isSessionLaneNestedRunFact(event)) {
    return;
  }
  if (typeof event.rootRunId !== 'string' || typeof event.sequence !== 'number') {
    return;
  }
  const last = state.rootRunSequences.get(event.rootRunId) ?? 0;
  if (event.sequence > last) {
    state.rootRunSequences.set(event.rootRunId, event.sequence);
  }
}

function ensureProjectedRun(state: ReducerInternalState, event: Record<string, unknown>): void {
  const runId = typeof event.runId === 'string' ? event.runId : undefined;
  const rootRunId = typeof event.rootRunId === 'string' ? event.rootRunId : undefined;
  if (!runId || !rootRunId || state.runs.has(runId)) {
    return;
  }
  state.runs = cloneMapWithEntry(state.runs, runId, {
    runId,
    rootRunId,
    sessionId: String(event.sessionId ?? state.sessionId),
    workflowId: typeof event.workflowId === 'string' ? event.workflowId : undefined,
    parentRunId: typeof event.parentRunId === 'string' ? event.parentRunId : undefined,
    parentToolCallId: typeof event.parentToolCallId === 'string' ? event.parentToolCallId : undefined,
    clientExecutorId: typeof event.clientExecutorId === 'string' ? event.clientExecutorId : undefined,
    state: 'running',
    stopRequested: false,
    lastSequence: readOptionalRunSequence(event) ?? 0,
  });
}

/**
 * Parent AAAT projections are session-lane facts, not run-tree authority. Apply them
 * best-effort so a single out-of-order child row cannot stall the parent cursor and
 * thrash catch-up ("Session history gap detected").
 */
function applyParentConversationProjection(state: ReducerInternalState, event: Record<string, unknown>): void {
  const type = String(event.type);
  switch (type) {
    case 'run.started': {
      if (!state.runs.has(String(event.runId))) {
        applyRunStarted(state, event);
      }
      return;
    }
    case 'run.paused': {
      ensureProjectedRun(state, event);
      const run = state.runs.get(String(event.runId));
      if (!run || run.openWaitId === String(event.waitId)) {
        return;
      }
      if (run.state !== 'running' && run.state !== 'paused') {
        state.runs = cloneMapWithEntry(state.runs, run.runId, { ...run, state: 'running' });
      }
      applyRunPaused(state, event);
      return;
    }
    case 'run.resumed': {
      ensureProjectedRun(state, event);
      const run = state.runs.get(String(event.runId));
      if (!run) {
        return;
      }
      if (run.state !== 'paused') {
        state.runs = cloneMapWithEntry(state.runs, run.runId, {
          ...run,
          state: 'paused',
          openWaitId: String(event.waitId),
        });
      }
      applyRunResumed(state, event);
      return;
    }
    case 'run.finished':
    case 'run.error':
    case 'run.cancelled': {
      ensureProjectedRun(state, event);
      const run = state.runs.get(String(event.runId));
      if (!run || run.state === 'finished' || run.state === 'error' || run.state === 'cancelled') {
        return;
      }
      if (run.state === 'paused') {
        state.runs = cloneMapWithEntry(state.runs, run.runId, {
          ...run,
          state: 'running',
          openWaitId: undefined,
          openInterruptId: undefined,
        });
      }
      applyRunTerminal(state, event, type);
      return;
    }
    case 'interrupt.requested': {
      ensureProjectedRun(state, event);
      if (state.interrupts.get(String(event.interruptId))?.open) {
        return;
      }
      const run = state.runs.get(String(event.runId));
      if (run && run.state !== 'running') {
        state.runs = cloneMapWithEntry(state.runs, run.runId, { ...run, state: 'running' });
      }
      applyInterruptRequested(state, event);
      return;
    }
    case 'interrupt.resolved': {
      const existing = state.interrupts.get(String(event.interruptId));
      if (!existing?.open) {
        return;
      }
      applyInterruptResolved(state, event);
      return;
    }
    case 'tool.call.started': {
      ensureProjectedRun(state, event);
      if (state.tools.has(String(event.toolCallId))) {
        return;
      }
      applyToolStarted(state, event);
      return;
    }
    case 'tool.call.finished': {
      if (!state.tools.get(String(event.toolCallId))?.open) {
        return;
      }
      applyToolFinished(state, event);
      return;
    }
    default:
      applyAuthorityMutation(state, event);
  }
}

function commitSessionAuthority(state: ReducerInternalState, event: Record<string, unknown>, limits: NaradLimits): void {
  const sessionSequence = Number(event.sessionSequence);
  const eventId = String(event.eventId);
  commitEventFingerprint(
    state.eventFingerprints,
    sessionDedupKey(state.sessionId, eventId),
    event,
    sessionSequence,
    limits,
  );
  state.lastSessionSequence = sessionSequence;
  if (typeof event.workflowId === 'string' && typeof event.workflowSequence === 'number') {
    state.workflowSequences.set(event.workflowId, event.workflowSequence);
  }
  noteObservedRootRunSequence(state, event);
}

function readRunUsage(event: Record<string, unknown>): RunUsage | undefined {
  const raw = event.usage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const promptTokens = typeof record.promptTokens === 'number' ? record.promptTokens : undefined;
  const completionTokens = typeof record.completionTokens === 'number' ? record.completionTokens : undefined;
  const totalTokens = typeof record.totalTokens === 'number' ? record.totalTokens : undefined;
  const elapsedMs = typeof record.elapsedMs === 'number' ? record.elapsedMs : undefined;
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    elapsedMs === undefined
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens, elapsedMs };
}

function applyRunStarted(state: ReducerInternalState, event: Record<string, unknown>): void {
  const runId = String(event.runId);
  state.runs = cloneMapWithEntry(state.runs, runId, {
    runId,
    rootRunId: String(event.rootRunId),
    sessionId: String(event.sessionId),
    workflowId: typeof event.workflowId === 'string' ? event.workflowId : undefined,
    parentRunId: typeof event.parentRunId === 'string' ? event.parentRunId : undefined,
    parentToolCallId: typeof event.parentToolCallId === 'string' ? event.parentToolCallId : undefined,
    clientExecutorId: typeof event.clientExecutorId === 'string' ? event.clientExecutorId : undefined,
    state: 'running',
    stopRequested: false,
    lastSequence: readOptionalRunSequence(event) ?? 0,
    startedAt: readEventTimestamp(event),
  });
  if (runId === String(event.rootRunId)) {
    state.activeRootRunId = runId;
  }
  if (typeof event.workflowId === 'string') {
    state.activeWorkflowId = event.workflowId;
  }
}

function applyRunPaused(state: ReducerInternalState, event: Record<string, unknown>): void {
  const runId = String(event.runId);
  const existing = state.runs.get(runId)!;
  state.runs = cloneMapWithEntry(state.runs, runId, {
    ...existing,
    state: 'paused',
    openWaitId: String(event.waitId),
    openInterruptId: typeof event.interruptId === 'string' ? event.interruptId : undefined,
    lastSequence: readOptionalRunSequence(event) ?? existing.lastSequence,
  });
  state.awaitingPauseAfterInterrupt.delete(runId);
}

function applyRunResumed(state: ReducerInternalState, event: Record<string, unknown>): void {
  const runId = String(event.runId);
  const existing = state.runs.get(runId)!;
  state.runs = cloneMapWithEntry(state.runs, runId, {
    ...existing,
    state: 'running',
    openWaitId: undefined,
    openInterruptId: undefined,
    lastSequence: readOptionalRunSequence(event) ?? existing.lastSequence,
  });
}

function applyRunStopRequested(state: ReducerInternalState, event: Record<string, unknown>): void {
  const targetRunId = String(event.targetRunId);
  const existing = state.runs.get(targetRunId)!;
  state.runs = cloneMapWithEntry(state.runs, targetRunId, {
    ...existing,
    stopRequested: true,
    lastSequence: readOptionalRunSequence(event) ?? existing.lastSequence,
  });
}

function applyRunTerminal(state: ReducerInternalState, event: Record<string, unknown>, type: string): void {
  const runId = String(event.runId);
  const existing = state.runs.get(runId)!;
  const terminal = terminalRunState(type)!;
  const usage = readRunUsage(event);
  state.runs = cloneMapWithEntry(state.runs, runId, {
    ...existing,
    state: terminal,
    openWaitId: undefined,
    openInterruptId: undefined,
    lastSequence: readOptionalRunSequence(event) ?? existing.lastSequence,
    completedAt: readEventTimestamp(event) ?? existing.completedAt,
    usage: usage ?? existing.usage,
  });
  if (state.activeRootRunId === runId) {
    state.activeRootRunId = null;
  }
}

function applyInterruptRequested(state: ReducerInternalState, event: Record<string, unknown>): void {
  const interruptId = String(event.interruptId);
  const scope = event.scope === 'workflow' ? 'workflow' : 'run';
  const runId = typeof event.runId === 'string' ? event.runId : undefined;
  const workflowId = typeof event.workflowId === 'string' ? event.workflowId : undefined;
  state.interrupts = cloneMapWithEntry(state.interrupts, interruptId, {
    interruptId,
    runId,
    rootRunId: typeof event.rootRunId === 'string' ? event.rootRunId : undefined,
    workflowId,
    scope,
    waitId: String(event.waitId),
    kind: String(event.kind),
    actions: Array.isArray(event.actions) ? event.actions.map(String) : [],
    open: true,
    expiresAt: typeof event.expiresAt === 'string' ? event.expiresAt : undefined,
    requestedAt: readEventTimestamp(event),
    title: typeof event.title === 'string' ? event.title : undefined,
    message: typeof event.message === 'string' ? event.message : undefined,
    input: event.input,
  });
  if (scope === 'run' && runId) {
    const sequence = readOptionalRunSequence(event);
    if (sequence !== undefined) {
      state.awaitingPauseAfterInterrupt.set(runId, sequence);
    }
  } else if (scope === 'workflow' && workflowId && typeof event.workflowSequence === 'number') {
    state.awaitingWorkflowPauseAfterInterrupt.set(workflowId, event.workflowSequence);
  }
}

function readInterruptMembers(value: unknown): InterruptMemberSnapshot[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const members: InterruptMemberSnapshot[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.requestId !== 'string' || record.requestId.length === 0) {
      continue;
    }
    members.push({
      requestId: record.requestId,
      toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
      toolName: typeof record.toolName === 'string' ? record.toolName : undefined,
      toolType: typeof record.toolType === 'string' ? record.toolType : undefined,
      decision: typeof record.decision === 'string' ? record.decision : undefined,
    });
  }
  return members.length > 0 ? members : undefined;
}

function applyInterruptResolved(state: ReducerInternalState, event: Record<string, unknown>): void {
  const interruptId = String(event.interruptId);
  const existing = state.interrupts.get(interruptId)!;
  state.interrupts = cloneMapWithEntry(state.interrupts, interruptId, {
    ...existing,
    decision: String(event.decision),
    members: readInterruptMembers(event.members) ?? existing.members,
    open: false,
    resolvedAt: readEventTimestamp(event) ?? existing.resolvedAt,
  });
}

function applyToolStarted(state: ReducerInternalState, event: Record<string, unknown>): void {
  state.tools = cloneMapWithEntry(state.tools, String(event.toolCallId), {
    toolCallId: String(event.toolCallId),
    runId: String(event.runId),
    rootRunId: String(event.rootRunId),
    toolName: String(event.toolName),
    executor: event.executor as 'backend' | 'client',
    args: event.args,
    parentToolCallId:
      typeof event.parentToolCallId === 'string' && event.parentToolCallId.length > 0
        ? event.parentToolCallId
        : undefined,
    open: true,
    startedAt: readEventTimestamp(event),
  });
}

function applyToolFinished(state: ReducerInternalState, event: Record<string, unknown>): void {
  const toolCallId = String(event.toolCallId);
  const existing = state.tools.get(toolCallId)!;
  state.tools = cloneMapWithEntry(state.tools, toolCallId, {
    ...existing,
    outcome: event.outcome as 'success' | 'error' | 'cancelled',
    response: event.response,
    code: typeof event.code === 'string' ? event.code : undefined,
    message: typeof event.message === 'string' ? event.message : undefined,
    open: false,
    completedAt: readEventTimestamp(event),
  });
}

function applyWorkflowLifecycle(state: ReducerInternalState, event: Record<string, unknown>): void {
  const workflowId = String(event.workflowId);
  const type = String(event.type);
  const existing = state.workflows.get(workflowId);
  const base = existing ?? {
    workflowId,
    sessionId: String(event.sessionId),
    state: 'running' as const,
    stopRequested: false,
    currentNodeId: undefined,
    lastWorkflowSequence: Number(event.workflowSequence),
    openWaitId: undefined,
    openInterruptId: undefined,
    steps: new Map(),
  };
  if (type === 'workflow.started' || type === 'workflow.resumed') {
    state.workflows = cloneMapWithEntry(state.workflows, workflowId, {
      ...base,
      sessionId: String(event.sessionId),
      state: 'running',
      currentNodeId: typeof event.nodeId === 'string' ? event.nodeId : base.currentNodeId,
      lastWorkflowSequence: Number(event.workflowSequence),
      openWaitId: type === 'workflow.resumed' ? undefined : base.openWaitId,
      openInterruptId: type === 'workflow.resumed' ? undefined : base.openInterruptId,
    });
    state.activeWorkflowId = workflowId;
    return;
  }
  if (type === 'workflow.paused') {
    state.workflows = cloneMapWithEntry(state.workflows, workflowId, {
      ...base,
      state: 'paused',
      currentNodeId: typeof event.nodeId === 'string' ? event.nodeId : base.currentNodeId,
      lastWorkflowSequence: Number(event.workflowSequence),
      openWaitId: typeof event.waitId === 'string' ? event.waitId : undefined,
      openInterruptId: typeof event.interruptId === 'string' ? event.interruptId : undefined,
    });
    state.awaitingWorkflowPauseAfterInterrupt.delete(workflowId);
    return;
  }
  if (type === 'workflow.stop.requested') {
    state.workflows = cloneMapWithEntry(state.workflows, workflowId, {
      ...base,
      stopRequested: true,
      lastWorkflowSequence: Number(event.workflowSequence),
    });
    return;
  }
  const terminal = workflowTerminalState(type);
  if (terminal) {
    state.workflows = cloneMapWithEntry(state.workflows, workflowId, {
      ...base,
      state: terminal,
      lastWorkflowSequence: Number(event.workflowSequence),
    });
    if (state.activeWorkflowId === workflowId) {
      state.activeWorkflowId = null;
    }
  }
}

function applyWorkflowStep(state: ReducerInternalState, event: Record<string, unknown>): void {
  const workflowId = String(event.workflowId);
  const nodeId = String(event.nodeId);
  const type = String(event.type);
  const existingWorkflow = state.workflows.get(workflowId) ?? {
    workflowId,
    sessionId: String(event.sessionId),
    state: 'running' as const,
    stopRequested: false,
    lastWorkflowSequence: Number(event.workflowSequence),
    steps: new Map(),
  };
  const status =
    type === 'workflow.step.started' ? 'running' : type === 'workflow.step.finished' ? 'finished' : 'failed';
  const steps = new Map(existingWorkflow.steps);
  const agentRunId = typeof event.agentRunId === 'string' ? event.agentRunId : undefined;
  const agentSessionId = typeof event.agentSessionId === 'string' ? event.agentSessionId : undefined;
  steps.set(nodeId, {
    nodeId,
    status,
    runId: agentRunId,
    sessionId: agentSessionId,
    attempt: typeof event.stepAttempt === 'number' ? event.stepAttempt : undefined,
  });
  state.workflows = cloneMapWithEntry(state.workflows, workflowId, {
    ...existingWorkflow,
    currentNodeId: nodeId,
    lastWorkflowSequence: Number(event.workflowSequence),
    steps,
  });
  state.activeWorkflowId = workflowId;
}

function applyConversationEvent(state: ReducerInternalState, event: Record<string, unknown>): void {
  const type = String(event.type);
  const presentation = conversationPresentationFields(state, event);
  switch (type) {
    case 'message.user.recorded':
      upsertConversationMessage(state, {
        messageId: String(event.messageId),
        role: 'user',
        content: String(event.content),
        messageScope: event.messageScope as ConversationMessageSnapshot['messageScope'],
        attachmentIds: Array.isArray(event.attachmentIds) ? event.attachmentIds.map(String) : undefined,
        ...presentation,
      });
      break;
    case 'message.text.started':
      upsertConversationMessage(state, {
        messageId: String(event.messageId),
        role: event.role as 'assistant' | 'system',
        content: '',
        messageScope: event.messageScope as ConversationMessageSnapshot['messageScope'],
        streaming: true,
        ...presentation,
      });
      break;
    case 'message.text.delta': {
      const messageId = String(event.messageId);
      const index = state.conversation.messageById.get(messageId);
      if (index === undefined) {
        throw new NaradClientError('invalid_lifecycle', 'Message stream target not found.');
      }
      const existing = state.conversation.messages[index]!;
      upsertConversationMessage(state, {
        ...existing,
        content: `${existing.content}${String(event.delta)}`,
        streaming: true,
      });
      break;
    }
    case 'message.text.completed': {
      const messageId = String(event.messageId);
      const index = state.conversation.messageById.get(messageId);
      if (index === undefined) {
        throw new NaradClientError('invalid_lifecycle', 'Message stream target not found.');
      }
      upsertConversationMessage(state, { ...state.conversation.messages[index]!, streaming: false });
      break;
    }
    case 'message.redacted': {
      const messageId = String(event.messageId);
      const index = state.conversation.messageById.get(messageId);
      if (index === undefined) {
        throw new NaradClientError('invalid_lifecycle', 'Message redaction target not found.');
      }
      upsertConversationMessage(state, {
        ...state.conversation.messages[index]!,
        redacted: true,
        displayReplacement: event.displayReplacement as string | null,
      });
      break;
    }
    case 'reasoning.started':
      state.reasoningById = cloneMapWithEntry(state.reasoningById, String(event.reasoningId), {
        reasoningId: String(event.reasoningId),
        messageId: typeof event.messageId === 'string' ? event.messageId : undefined,
        content: '',
        completed: false,
        timestamp: readEventTimestamp(event),
      });
      syncConversationReasoning(state);
      break;
    case 'reasoning.delta': {
      const reasoningId = String(event.reasoningId);
      const existing = state.reasoningById.get(reasoningId);
      if (!existing) {
        throw new NaradClientError('invalid_lifecycle', 'Reasoning stream target not found.');
      }
      state.reasoningById = cloneMapWithEntry(state.reasoningById, reasoningId, {
        ...existing,
        content: `${existing.content}${String(event.delta)}`,
      });
      syncConversationReasoning(state);
      break;
    }
    case 'reasoning.completed': {
      const reasoningId = String(event.reasoningId);
      const existing = state.reasoningById.get(reasoningId);
      if (!existing) {
        throw new NaradClientError('invalid_lifecycle', 'Reasoning stream target not found.');
      }
      state.reasoningById = cloneMapWithEntry(state.reasoningById, reasoningId, { ...existing, completed: true });
      syncConversationReasoning(state);
      break;
    }
    default:
      break;
  }
}

function applyAttachmentOrArtifact(state: ReducerInternalState, event: Record<string, unknown>): void {
  const type = String(event.type);
  if (type.startsWith('attachment.')) {
    state.attachments = cloneMapWithEntry(state.attachments, String(event.attachmentId), {
      attachmentId: String(event.attachmentId),
      state: type.slice('attachment.'.length) as 'added' | 'ready' | 'failed' | 'removed',
      code: typeof event.code === 'string' ? event.code : undefined,
      message: typeof event.message === 'string' ? event.message : undefined,
    });
    return;
  }
  state.artifacts = cloneMapWithEntry(state.artifacts, String(event.artifactId), {
    artifactId: String(event.artifactId),
    state: type.slice('artifact.'.length) as 'added' | 'ready' | 'failed',
    code: typeof event.code === 'string' ? event.code : undefined,
    message: typeof event.message === 'string' ? event.message : undefined,
  });
}

function applyScopedState(
  state: ReducerInternalState,
  event: Record<string, unknown>,
  target: 'scopedState' | 'uiState',
): void {
  const type = String(event.type);
  const scope = String(event.scope ?? 'session');
  const key = stateScopeKey(
    scope,
    String(event.sessionId),
    typeof event.workflowId === 'string' ? event.workflowId : undefined,
    typeof event.rootRunId === 'string' ? event.rootRunId : undefined,
    typeof event.runId === 'string' ? event.runId : undefined,
  );
  const map = state[target];

  if (type.endsWith('.snapshot')) {
    state[target] = cloneMapWithEntry(map, key, {
      scope: scope as 'session' | 'workflow' | 'run',
      scopeKey: key,
      revision: Number(event.revision),
      state: event.state,
      deltaGap: false,
      resyncRequired: false,
    });
    return;
  }

  if (type.endsWith('.delta')) {
    const existing = map.get(key);
    const baseRevision = Number(event.baseRevision);
    const revision = Number(event.revision);
    if (!existing || existing.revision !== baseRevision || revision !== baseRevision + 1) {
      if (existing) {
        state[target] = cloneMapWithEntry(map, key, { ...existing, deltaGap: true, resyncRequired: true });
        state.resyncRequired = true;
      }
      return;
    }
    const patch = parseJsonPatchOperations(event.patch);
    state[target] = cloneMapWithEntry(map, key, {
      ...existing,
      revision,
      state: applySafeJsonPatch(existing.state, patch),
      deltaGap: false,
      resyncRequired: false,
    });
    return;
  }

  if (type === 'state.compacted') {
    const existing = map.get(key);
    if (!existing) {
      throw new NaradClientError('invalid_lifecycle', 'State compaction target not found.');
    }
    state[target] = cloneMapWithEntry(map, key, {
      ...existing,
      revision: Number(event.snapshotRevision),
      deltaGap: false,
      resyncRequired: true,
    });
    state.resyncRequired = true;
  }
}


function applyProgress(state: ReducerInternalState, event: Record<string, unknown>): void {
  const runId = String(event.runId);
  if (state.awaitingPauseAfterInterrupt.has(runId)) {
    throw new NaradClientError('invalid_lifecycle', 'Progress must not interleave interrupt and pause.');
  }
  const progressId = String(event.progressId);
  const existingRunMap = state.progressByRun.get(runId) ?? new Map();
  const existing = existingRunMap.get(progressId);
  const timestamp = readEventTimestamp(event);
  const nextRunMap = new Map(existingRunMap);
  nextRunMap.set(progressId, {
    progressId,
    runId,
    rootRunId: String(event.rootRunId),
    category: String(event.category),
    label: String(event.label),
    detail: typeof event.detail === 'string' ? event.detail : existing?.detail,
    status: event.status as 'active' | 'completed' | 'failed' | 'cancelled',
    privacy: event.privacy as 'public' | 'internal' | 'sensitive',
    recordedAt: existing?.recordedAt ?? timestamp,
    updatedAt: timestamp,
    usage: readRunUsage(event) ?? existing?.usage,
  });
  state.progressByRun = cloneMapWithEntry(state.progressByRun, runId, nextRunMap);
}

function applyViewEvent(state: ReducerInternalState, event: Record<string, unknown>): void {
  const viewId = String(event.viewId);
  const type = String(event.type);
  if (type === 'view.opened') {
    state.views = cloneMapWithEntry(state.views, viewId, { viewId, open: true, model: event.model });
    return;
  }
  if (type === 'view.closed') {
    state.views = cloneMapWithEntry(state.views, viewId, {
      viewId,
      open: false,
      model: state.views.get(viewId)?.model,
    });
    return;
  }
  const existing = state.views.get(viewId)!;
  if (event.operation === 'replace') {
    state.views = cloneMapWithEntry(state.views, viewId, { ...existing, model: event.model });
    return;
  }
  const patch = parseJsonPatchOperations(event.patch);
  state.views = cloneMapWithEntry(state.views, viewId, {
    ...existing,
    model: applySafeJsonPatch(existing.model ?? {}, patch),
  });
}

function applyAuthorityMutation(state: ReducerInternalState, event: Record<string, unknown>): void {
  const type = String(event.type);
  switch (type) {
    case 'run.started':
      applyRunStarted(state, event);
      break;
    case 'run.paused':
      applyRunPaused(state, event);
      break;
    case 'run.resumed':
      applyRunResumed(state, event);
      break;
    case 'run.stop.requested':
      applyRunStopRequested(state, event);
      break;
    case 'run.finished':
    case 'run.error':
    case 'run.cancelled':
      applyRunTerminal(state, event, type);
      break;
    case 'interrupt.requested':
      applyInterruptRequested(state, event);
      break;
    case 'interrupt.resolved':
      applyInterruptResolved(state, event);
      break;
    case 'tool.call.started':
      applyToolStarted(state, event);
      break;
    case 'tool.call.finished':
      applyToolFinished(state, event);
      break;
    case 'workflow.started':
    case 'workflow.paused':
    case 'workflow.resumed':
    case 'workflow.stop.requested':
    case 'workflow.finished':
    case 'workflow.error':
    case 'workflow.cancelled':
      applyWorkflowLifecycle(state, event);
      break;
    case 'workflow.step.started':
    case 'workflow.step.finished':
    case 'workflow.step.failed':
      applyWorkflowStep(state, event);
      break;
    default:
      if (type.startsWith('message.') || type.startsWith('reasoning.')) {
        applyConversationEvent(state, event);
      } else if (type.startsWith('attachment.') || type.startsWith('artifact.')) {
        applyAttachmentOrArtifact(state, event);
      } else if (type.startsWith('state.')) {
        applyScopedState(state, event, 'scopedState');
      } else if (type.startsWith('ui.state.')) {
        applyScopedState(state, event, 'uiState');
      } else if (type === 'progress.recorded') {
        applyProgress(state, event);
      } else if (type.startsWith('view.')) {
        applyViewEvent(state, event);
      }
      break;
  }
}

function applyWorkspaceWatch(state: ReducerInternalState, event: Record<string, unknown>, limits: NaradLimits): ReducerApplyResult {
  const workspaceId = String(event.workspaceId);
  const eventId = String(event.eventId);
  const dedupKey = workspaceDedupKey(workspaceId, eventId);
  try {
    const identity = checkEventIdentity(
      state.workspaceEventFingerprints,
      dedupKey,
      eventId,
      event,
      Number(event.revision),
      limits,
    );
    if (identity === 'duplicate') {
      return duplicate();
    }
  } catch (error) {
    return rejected(state, error instanceof NaradClientError ? error.message : 'Workspace event conflict.', true);
  }
  validateWatchSemantics(state, event);
  commitEventFingerprint(state.workspaceEventFingerprints, dedupKey, event, Number(event.revision), limits);
  const revision = Number(event.revision);
  const current = state.workspace ?? { workspaceId, revision: 0, sessions: [] };
  let sessions = current.sessions;
  const type = String(event.type);
  if (type === 'session.created' || type === 'session.updated') {
    sessions = upsertWorkspaceSession(sessions, String(event.sessionId), false);
  } else if (type === 'session.archived') {
    sessions = upsertWorkspaceSession(sessions, String(event.sessionId), true);
  }
  state.workspace = { workspaceId, revision: Math.max(current.revision, revision), sessions };
  return success(state);
}

function applyWatchRevision(state: ReducerInternalState, event: Record<string, unknown>, limits: NaradLimits): ReducerApplyResult {
  const eventId = String(event.eventId);
  const dedupKey = sessionDedupKey(state.sessionId, eventId);
  try {
    const identity = checkEventIdentity(state.eventFingerprints, dedupKey, eventId, event, Number(event.revision), limits);
    if (identity === 'duplicate') {
      return duplicate();
    }
  } catch (error) {
    return rejected(state, error instanceof NaradClientError ? error.message : 'Watch event conflict.', true);
  }
  validateWatchSemantics(state, event);
  commitEventFingerprint(state.eventFingerprints, dedupKey, event, Number(event.revision), limits);
  const type = String(event.type);
  const revision = Number(event.revision);
  if (type === 'session.revision') {
    state.sessionRevision = revision;
  } else if (type === 'run.revision') {
    state.runRevisions = cloneMapWithEntry(state.runRevisions, String(event.runId), revision);
  } else if (type === 'workflow.revision') {
    state.workflowRevisions = cloneMapWithEntry(state.workflowRevisions, String(event.workflowId), revision);
  } else if (type === 'node.revision') {
    state.nodeRevisions = cloneMapWithEntry(state.nodeRevisions, String(event.nodeId), revision);
  }
  return success(state);
}

export function applyAuthorityEventToState(
  state: ReducerInternalState,
  event: Record<string, unknown>,
  limits: NaradLimits,
): ReducerApplyResult {
  const preflight = preflightSessionAuthority(state, event, limits);
  if (preflight !== 'ok') {
    return preflight;
  }
  const projection = isSessionLaneNestedRunFact(event);
  try {
    if (projection) {
      applyParentConversationProjection(state, event);
    } else {
      validateAuthoritySemantics(state, event);
      applyAuthorityMutation(state, event);
    }
  } catch (error) {
    if (projection) {
      // Session-lane nested projections must not stall parent conversation sequence.
      commitSessionAuthority(state, event, limits);
      return success(state);
    }
    const message = error instanceof NaradClientError ? error.message : 'Authority event rejected.';
    return rejected(state, message, error instanceof NaradClientError && error.code.includes('conflict'));
  }
  commitSessionAuthority(state, event, limits);
  if (typeof event.rootRunId === 'string') {
    drainPendingGraphHydrates(state, String(event.rootRunId), limits);
  }
  return success(state);
}

export function applyWatchEventToState(
  state: ReducerInternalState,
  event: Record<string, unknown>,
  limits: NaradLimits,
): ReducerApplyResult {
  const type = String(event.type);
  try {
    if (
      type === 'workspace.revision' ||
      type === 'session.created' ||
      type === 'session.updated' ||
      type === 'session.archived'
    ) {
      return applyWorkspaceWatch(state, event, limits);
    }
    return applyWatchRevision(state, event, limits);
  } catch (error) {
    const message = error instanceof NaradClientError ? error.message : 'Watch event rejected.';
    return rejected(state, message, true);
  }
}

export function applyHydrateRecordToState(
  state: ReducerInternalState,
  record: ValidatedHydrateRecord,
  limits: NaradLimits,
): ReducerApplyResult {
  if (record.type === 'graph.snapshot' || record.type === 'graph.delta') {
    return applyGraphHydrateRecordToState(state, record, limits);
  }
  if (record.sessionId !== state.sessionId) {
    return rejected(state, 'Hydrate session mismatch.');
  }
  const coversThrough = Number(record.coversThroughSessionSequence);
  const snapshotMessages = Array.isArray(record.messages)
    ? record.messages
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const message = item as Record<string, unknown>;
          return {
            messageId: String(message.messageId),
            role: (message.role as ConversationMessageSnapshot['role']) ?? 'assistant',
            content: typeof message.content === 'string' ? message.content : '',
            messageScope:
              typeof message.messageScope === 'string'
                ? (message.messageScope as ConversationMessageSnapshot['messageScope'])
                : undefined,
            sessionSequence:
              typeof message.sessionSequence === 'number' ? message.sessionSequence : undefined,
            streaming: message.completed === false,
            timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
            rootRunId: typeof message.rootRunId === 'string' ? message.rootRunId : undefined,
            runId: typeof message.runId === 'string' ? message.runId : undefined,
            attachmentIds: Array.isArray(message.attachmentIds)
              ? message.attachmentIds.map(String)
              : undefined,
          } satisfies ConversationMessageSnapshot;
        })
    : [];
  const liveAhead = coversThrough < state.lastSessionSequence && state.conversation.messages.length > 0;
  const mergedMessages = liveAhead
    ? mergeLiveTranscriptWithSnapshot(state.conversation.messages, snapshotMessages, coversThrough)
    : snapshotMessages;
  if (liveAhead && conversationMessagesEqual(mergedMessages, state.conversation.messages)) {
    return skip(state);
  }
  const messageById = new Map<string, number>();
  mergedMessages.forEach((message, index) => {
    messageById.set(message.messageId, index);
  });
  state.conversation = {
    messages: mergedMessages,
    messageById,
    reasoning: liveAhead ? state.conversation.reasoning : [],
    coversThroughSessionSequence: liveAhead
      ? Math.max(state.conversation.coversThroughSessionSequence, coversThrough)
      : coversThrough,
  };
  if (!liveAhead) {
    state.reasoningById = new Map();
  }
  return success(state);
}

function mergeLiveTranscriptWithSnapshot(
  existing: readonly ConversationMessageSnapshot[],
  snapshotMessages: readonly ConversationMessageSnapshot[],
  coversThrough: number,
): ConversationMessageSnapshot[] {
  // Replace only the prefix the snapshot covers. Keep later live turns.
  const snapshotIds = new Set(snapshotMessages.map((message) => message.messageId));
  const liveTail = existing.filter((message) => {
    if (typeof message.sessionSequence === 'number') {
      return message.sessionSequence > coversThrough;
    }
    return !snapshotIds.has(message.messageId);
  });
  const tailIds = new Set(liveTail.map((message) => message.messageId));
  return [...snapshotMessages.filter((message) => !tailIds.has(message.messageId)), ...liveTail];
}

function conversationMessagesEqual(
  left: readonly ConversationMessageSnapshot[],
  right: readonly ConversationMessageSnapshot[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (message, index) =>
      message.messageId === right[index]?.messageId &&
      message.role === right[index]?.role &&
      message.content === right[index]?.content,
  );
}

export { createInitialReducerState } from './state.js';