import { NARAD_PROFILE_IDS, type NaradProfileId } from './types.js';

export type WireRecordClass = 'authority' | 'watch' | 'hydrate' | 'control' | 'unknown';

export interface WireEnvelopeBase {
  readonly type: string;
  readonly protocolVersion: string;
}

export interface AuthorityEnvelope extends WireEnvelopeBase {
  readonly eventId: string;
  readonly timestamp: string;
  readonly sessionId?: string;
  readonly sessionSequence?: number;
  readonly workflowId?: string;
  readonly workflowSequence?: number;
  readonly rootRunId?: string;
  readonly runId?: string;
  readonly sequence?: number;
}

export interface WatchEnvelope extends WireEnvelopeBase {
  readonly eventId: string;
  readonly timestamp: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly rootRunId?: string;
  readonly runId?: string;
  readonly nodeId?: string;
  readonly workspaceId?: string;
  readonly revision: number;
}

export interface HydrateEnvelope extends WireEnvelopeBase {
  readonly timestamp: string;
}

export interface ControlEnvelope extends WireEnvelopeBase {
  readonly clientExecutorId?: string;
  readonly leaseId?: string;
}

export type CoreAuthorityType =
  | 'run.started'
  | 'run.paused'
  | 'run.resumed'
  | 'run.stop.requested'
  | 'run.finished'
  | 'run.error'
  | 'run.cancelled'
  | 'interrupt.requested'
  | 'interrupt.resolved'
  | 'tool.call.started'
  | 'tool.call.finished';

export type CoreWatchType = 'session.revision' | 'run.revision';

export type ControlType =
  | 'client.attached'
  | 'server.heartbeat'
  | 'client.heartbeat'
  | 'client.tool.execute'
  | 'client.tool.finish';

export type HydrateType = 'messages.snapshot' | 'graph.snapshot' | 'graph.delta';

const CORE_AUTHORITY_TYPES = new Set<string>([
  'run.started',
  'run.paused',
  'run.resumed',
  'run.stop.requested',
  'run.finished',
  'run.error',
  'run.cancelled',
  'interrupt.requested',
  'interrupt.resolved',
  'tool.call.started',
  'tool.call.finished',
]);

const CORE_WATCH_TYPES = new Set<string>(['session.revision', 'run.revision']);

const CONTROL_TYPES = new Set<string>([
  'client.attached',
  'server.heartbeat',
  'client.heartbeat',
  'client.tool.execute',
  'client.tool.finish',
]);

const HYDRATE_TYPES = new Set<string>(['messages.snapshot', 'graph.snapshot', 'graph.delta']);

const WORKSPACE_WATCH_TYPES = new Set<string>([
  'workspace.revision',
  'session.created',
  'session.updated',
  'session.archived',
]);

const WORKFLOW_WATCH_TYPES = new Set<string>(['workflow.revision', 'node.revision']);

export function classifyWireRecord(value: unknown): WireRecordClass {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return 'unknown';
  }
  const type = value.type;
  if (CONTROL_TYPES.has(type)) {
    return 'control';
  }
  if (HYDRATE_TYPES.has(type)) {
    return 'hydrate';
  }
  if (CORE_WATCH_TYPES.has(type) || WORKSPACE_WATCH_TYPES.has(type) || WORKFLOW_WATCH_TYPES.has(type)) {
    return 'watch';
  }
  if (typeof value.eventId === 'string') {
    return 'authority';
  }
  return 'unknown';
}

export function resolveProfileForEventType(type: string): NaradProfileId | null {
  if (CORE_AUTHORITY_TYPES.has(type) || CORE_WATCH_TYPES.has(type)) {
    return null;
  }
  if (type.startsWith('workflow.')) {
    return NARAD_PROFILE_IDS.workflow;
  }
  if (type.startsWith('message.') || type.startsWith('reasoning.')) {
    return NARAD_PROFILE_IDS.conversation;
  }
  if (type.startsWith('attachment.')) {
    return NARAD_PROFILE_IDS.attachments;
  }
  if (type.startsWith('artifact.')) {
    return NARAD_PROFILE_IDS.artifacts;
  }
  if (type.startsWith('state.')) {
    return NARAD_PROFILE_IDS.state;
  }
  if (type.startsWith('ui.state.') || type.startsWith('view.')) {
    return NARAD_PROFILE_IDS.ui;
  }
  if (type.startsWith('graph.')) {
    return NARAD_PROFILE_IDS.graph;
  }
  if (type.startsWith('progress.')) {
    return NARAD_PROFILE_IDS.progress;
  }
  if (WORKSPACE_WATCH_TYPES.has(type)) {
    return NARAD_PROFILE_IDS.workspace;
  }
  if (type.endsWith('.custom') || type.endsWith('.raw')) {
    return NARAD_PROFILE_IDS.extensions;
  }
  if (type.startsWith('trace.')) {
    return NARAD_PROFILE_IDS.trace;
  }
  if (type.startsWith('debug.')) {
    return NARAD_PROFILE_IDS.debug;
  }
  if (WORKFLOW_WATCH_TYPES.has(type)) {
    return NARAD_PROFILE_IDS.workflow;
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asAuthorityEnvelope(value: Record<string, unknown>): AuthorityEnvelope {
  return value as unknown as AuthorityEnvelope;
}

export function asWatchEnvelope(value: Record<string, unknown>): WatchEnvelope {
  return value as unknown as WatchEnvelope;
}

export function asControlEnvelope(value: Record<string, unknown>): ControlEnvelope {
  return value as unknown as ControlEnvelope;
}

export function asHydrateEnvelope(value: Record<string, unknown>): HydrateEnvelope {
  return value as unknown as HydrateEnvelope;
}
