import { NaradClientError } from '../security.js';
import type { ReducerInternalState } from './state.js';

const TERMINAL_RUN_STATES = new Set(['finished', 'error', 'cancelled']);

function requireRun(state: ReducerInternalState, runId: string) {
  const run = state.runs.get(runId);
  if (!run) {
    throw new NaradClientError('invalid_lifecycle', 'Referenced run has not started.');
  }
  return run;
}

function isRunTerminal(run: { state: string }): boolean {
  return TERMINAL_RUN_STATES.has(run.state);
}

export function validateAuthoritySemantics(state: ReducerInternalState, event: Record<string, unknown>): void {
  const type = String(event.type);
  const runId = typeof event.runId === 'string' ? event.runId : undefined;
  if (runId && state.awaitingPauseAfterInterrupt.has(runId) && type !== 'run.paused') {
    throw new NaradClientError('invalid_lifecycle', 'Pause must follow interrupt consecutively.');
  }
  const workflowId = typeof event.workflowId === 'string' ? event.workflowId : undefined;
  if (workflowId && state.awaitingWorkflowPauseAfterInterrupt.has(workflowId) && type !== 'workflow.paused') {
    throw new NaradClientError('invalid_lifecycle', 'Pause must follow interrupt consecutively.');
  }

  switch (type) {
    case 'run.started': {
      const id = String(event.runId);
      if (state.runs.has(id)) {
        throw new NaradClientError('invalid_lifecycle', 'Run already started.');
      }
      if (typeof event.parentRunId === 'string' && !state.runs.has(event.parentRunId)) {
        throw new NaradClientError('invalid_lifecycle', 'Parent run has not started.');
      }
      break;
    }
    case 'run.paused': {
      const run = requireRun(state, String(event.runId));
      if (run.state !== 'running') {
        throw new NaradClientError('invalid_lifecycle', 'Run must be running to pause.');
      }
      if (run.openWaitId) {
        throw new NaradClientError('invalid_lifecycle', 'Run already has an open pause cycle.');
      }
      break;
    }
    case 'run.resumed': {
      const run = requireRun(state, String(event.runId));
      if (run.state !== 'paused') {
        throw new NaradClientError('invalid_lifecycle', 'Run must be paused to resume.');
      }
      if (run.openWaitId !== String(event.waitId)) {
        throw new NaradClientError('invalid_lifecycle', 'Pause cycle waitId does not match.');
      }
      break;
    }
    case 'run.finished':
    case 'run.error':
    case 'run.cancelled': {
      const run = requireRun(state, String(event.runId));
      if (run.state === 'paused') {
        throw new NaradClientError('invalid_lifecycle', 'Paused run must resume before terminal.');
      }
      if (run.state !== 'running') {
        throw new NaradClientError('invalid_lifecycle', 'Run must be running to terminate.');
      }
      break;
    }
    case 'run.stop.requested': {
      requireRun(state, String(event.targetRunId));
      break;
    }
    case 'interrupt.requested': {
      if (event.scope === 'workflow') {
        const workflow = state.workflows.get(String(event.workflowId));
        if (!workflow) {
          throw new NaradClientError('invalid_lifecycle', 'Referenced workflow has not started.');
        }
        if (workflow.state !== 'running') {
          throw new NaradClientError('invalid_lifecycle', 'Interrupt requires a running workflow.');
        }
        if (state.interrupts.get(String(event.interruptId))?.open) {
          throw new NaradClientError('invalid_lifecycle', 'Interrupt already open.');
        }
        for (const existing of state.interrupts.values()) {
          if (existing.open && existing.scope === 'workflow' && existing.workflowId === workflow.workflowId) {
            throw new NaradClientError('invalid_lifecycle', 'Workflow already has an open interrupt.');
          }
        }
        break;
      }
      const run = requireRun(state, String(event.runId));
      if (run.state !== 'running') {
        throw new NaradClientError('invalid_lifecycle', 'Interrupt requires a running run.');
      }
      if (state.interrupts.get(String(event.interruptId))?.open) {
        throw new NaradClientError('invalid_lifecycle', 'Interrupt already open.');
      }
      for (const existing of state.interrupts.values()) {
        if (existing.open && existing.runId === String(event.runId)) {
          throw new NaradClientError('invalid_lifecycle', 'Run already has an open interrupt.');
        }
      }
      break;
    }
    case 'interrupt.resolved': {
      const interrupt = state.interrupts.get(String(event.interruptId));
      if (!interrupt?.open || interrupt.waitId !== String(event.waitId)) {
        throw new NaradClientError('invalid_lifecycle', 'No matching open interrupt.');
      }
      const decision = String(event.decision);
      if (decision !== 'expired' && !interrupt.actions.includes(decision)) {
        throw new NaradClientError('invalid_lifecycle', 'Decision is not one of the interrupt actions.');
      }
      if (Array.isArray(event.members)) {
        for (const raw of event.members) {
          if (typeof raw !== 'object' || raw === null) {
            continue;
          }
          const memberDecision = (raw as Record<string, unknown>).decision;
          if (
            typeof memberDecision === 'string' &&
            memberDecision !== 'expired' &&
            !interrupt.actions.includes(memberDecision)
          ) {
            throw new NaradClientError('invalid_lifecycle', 'Decision is not one of the interrupt actions.');
          }
        }
      }
      break;
    }
    case 'tool.call.started': {
      const run = requireRun(state, String(event.runId));
      if (run.state !== 'running') {
        throw new NaradClientError('invalid_lifecycle', 'Tool call requires a running run.');
      }
      if (state.tools.has(String(event.toolCallId))) {
        throw new NaradClientError('invalid_lifecycle', 'Tool call already started.');
      }
      break;
    }
    case 'tool.call.finished': {
      const tool = state.tools.get(String(event.toolCallId));
      if (!tool?.open) {
        throw new NaradClientError('invalid_lifecycle', 'No open tool call to finish.');
      }
      if (tool.runId !== String(event.runId)) {
        throw new NaradClientError('invalid_lifecycle', 'Tool call run mismatch.');
      }
      break;
    }
    case 'progress.recorded': {
      const run = requireRun(state, String(event.runId));
      if (isRunTerminal(run)) {
        throw new NaradClientError('invalid_lifecycle', 'Progress must not be emitted after run terminal.');
      }
      if (run.state !== 'running' && run.state !== 'paused') {
        throw new NaradClientError('invalid_lifecycle', 'Progress requires a running or paused run.');
      }
      break;
    }
    case 'view.updated': {
      if (!state.views.has(String(event.viewId))) {
        throw new NaradClientError('invalid_lifecycle', 'View must be opened before update.');
      }
      break;
    }
    case 'view.closed': {
      if (!state.views.has(String(event.viewId))) {
        throw new NaradClientError('invalid_lifecycle', 'View must exist before close.');
      }
      break;
    }
    case 'workflow.paused': {
      const workflow = state.workflows.get(String(event.workflowId));
      if (!workflow) {
        throw new NaradClientError('invalid_lifecycle', 'Referenced workflow has not started.');
      }
      if (workflow.state !== 'running') {
        throw new NaradClientError('invalid_lifecycle', 'Workflow must be running to pause.');
      }
      if (workflow.openWaitId) {
        throw new NaradClientError('invalid_lifecycle', 'Workflow already has an open pause cycle.');
      }
      break;
    }
    case 'workflow.resumed': {
      const workflow = state.workflows.get(String(event.workflowId));
      if (!workflow) {
        throw new NaradClientError('invalid_lifecycle', 'Referenced workflow has not started.');
      }
      if (workflow.state !== 'paused') {
        throw new NaradClientError('invalid_lifecycle', 'Workflow must be paused to resume.');
      }
      if (workflow.openWaitId !== String(event.waitId)) {
        throw new NaradClientError('invalid_lifecycle', 'Pause cycle waitId does not match.');
      }
      break;
    }
    default:
      if (runId && (type.startsWith('tool.') || type.startsWith('interrupt.'))) {
        requireRun(state, runId);
      }
      break;
  }
}

export function validateWatchSemantics(state: ReducerInternalState, event: Record<string, unknown>): void {
  const type = String(event.type);
  const revision = Number(event.revision);

  if (type === 'workflow.revision') {
    const workflowId = String(event.workflowId);
    const previous = state.workflowRevisions.get(workflowId) ?? 0;
    if (revision <= previous) {
      throw new NaradClientError('watch_revision_regress', 'Workflow watch revision regressed.');
    }
  }

  if (type === 'node.revision') {
    const nodeId = String(event.nodeId);
    const previous = state.nodeRevisions.get(nodeId) ?? 0;
    if (revision <= previous) {
      throw new NaradClientError('watch_revision_regress', 'Node watch revision regressed.');
    }
  }

  if (type === 'session.revision') {
    if (state.sessionRevision !== null && revision <= state.sessionRevision) {
      throw new NaradClientError('watch_revision_regress', 'Session watch revision regressed.');
    }
  }

  if (type === 'run.revision') {
    const runId = String(event.runId);
    const previous = state.runRevisions.get(runId) ?? 0;
    if (revision <= previous) {
      throw new NaradClientError('watch_revision_regress', 'Run watch revision regressed.');
    }
  }

  if (type === 'workspace.revision' && state.workspace && revision <= state.workspace.revision) {
    throw new NaradClientError('watch_revision_regress', 'Workspace watch revision regressed.');
  }
}
