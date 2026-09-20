import {
  NaradClientError,
  assertWithinLimits,
  requireDottedLowercaseType,
  requireEnum,
  requireInteger,
  requireIsoDateTime,
  requireNonEmptyString,
  requireProtocolVersion,
  requireRecord,
} from '../security.js';
import type { NaradLimits, NaradProfileId } from '../types.js';
import { NARAD_PROFILE_IDS } from '../types.js';
import { resolveProfileForEventType } from '../wire.js';

const PROFILE_AUTHORITY_TYPES = new Set<string>([
  'workflow.started',
  'workflow.paused',
  'workflow.resumed',
  'workflow.stop.requested',
  'workflow.finished',
  'workflow.error',
  'workflow.cancelled',
  'workflow.step.started',
  'workflow.step.finished',
  'workflow.step.failed',
  'message.user.recorded',
  'message.text.started',
  'message.text.delta',
  'message.text.completed',
  'message.redacted',
  'reasoning.started',
  'reasoning.delta',
  'reasoning.completed',
  'attachment.added',
  'attachment.ready',
  'attachment.failed',
  'attachment.removed',
  'artifact.added',
  'artifact.ready',
  'artifact.failed',
  'state.snapshot',
  'state.delta',
  'state.compacted',
  'ui.state.snapshot',
  'ui.state.delta',
  'view.opened',
  'view.updated',
  'view.closed',
  'progress.recorded',
  'session.custom',
  'session.raw',
  'workflow.custom',
  'workflow.raw',
  'run.custom',
  'run.raw',
  'node.custom',
  'node.raw',
  'trace.span.started',
  'trace.span.completed',
  'trace.event',
  'debug.log',
  'debug.snapshot',
]);

const PROFILE_WATCH_TYPES = new Set<string>(['workflow.revision', 'node.revision']);

const WORKSPACE_WATCH_TYPES = new Set<string>([
  'workspace.revision',
  'session.created',
  'session.updated',
  'session.archived',
]);

function validateBaseEnvelope(record: Record<string, unknown>): void {
  requireDottedLowercaseType(record, 'type');
  requireProtocolVersion(record);
  requireNonEmptyString(record, 'eventId');
  requireIsoDateTime(record, 'timestamp');
}

function validateSessionAuthorityFields(record: Record<string, unknown>): void {
  requireNonEmptyString(record, 'sessionId');
  requireInteger(record, 'sessionSequence', 1);
}

function validateWorkflowFields(record: Record<string, unknown>): void {
  requireNonEmptyString(record, 'workflowId');
  requireInteger(record, 'workflowSequence', 1);
}

function isParentConversationProjection(record: Record<string, unknown>): boolean {
  return typeof record.sourceEventId === 'string' && record.sourceEventId.length > 0;
}

function validateRunTreeFields(record: Record<string, unknown>): void {
  requireNonEmptyString(record, 'rootRunId');
  requireNonEmptyString(record, 'runId');
  if (isParentConversationProjection(record)) {
    requireNonEmptyString(record, 'sourceSessionId');
    if ('sequence' in record || 'workflowId' in record || 'workflowSequence' in record) {
      throw new NaradClientError(
        'invalid_record',
        'Parent conversation projections must not carry run-tree or workflow sequence fields.',
      );
    }
    return;
  }
  requireInteger(record, 'sequence', 1);
}

function validateProfileAuthorityShape(record: Record<string, unknown>): void {
  validateBaseEnvelope(record);
  validateSessionAuthorityFields(record);
  const type = String(record.type);

  if (type.startsWith('workflow.') && type !== 'workflow.revision') {
    validateWorkflowFields(record);
  }

  switch (type) {
    case 'workflow.step.started':
    case 'workflow.step.finished':
    case 'workflow.step.failed':
      requireNonEmptyString(record, 'nodeId');
      break;
    case 'workflow.paused':
      requireNonEmptyString(record, 'waitId');
      requireNonEmptyString(record, 'interruptId');
      break;
    case 'workflow.resumed':
      requireNonEmptyString(record, 'waitId');
      break;
    case 'message.user.recorded':
      requireNonEmptyString(record, 'messageId');
      if (typeof record.content !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing content.');
      }
      requireEnum(record, 'messageScope', ['session', 'workflow', 'run'] as const);
      break;
    case 'message.text.started':
      requireNonEmptyString(record, 'messageId');
      requireEnum(record, 'role', ['assistant', 'system'] as const);
      requireEnum(record, 'messageScope', ['session', 'workflow', 'run'] as const);
      break;
    case 'message.text.delta':
      requireNonEmptyString(record, 'messageId');
      if (typeof record.delta !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing delta.');
      }
      break;
    case 'message.text.completed':
      requireNonEmptyString(record, 'messageId');
      break;
    case 'message.redacted':
      requireNonEmptyString(record, 'messageId');
      requireNonEmptyString(record, 'reason');
      if (!('displayReplacement' in record)) {
        throw new NaradClientError('invalid_record', 'Missing displayReplacement.');
      }
      break;
    case 'reasoning.started':
    case 'reasoning.completed':
      requireNonEmptyString(record, 'reasoningId');
      break;
    case 'reasoning.delta':
      requireNonEmptyString(record, 'reasoningId');
      if (typeof record.delta !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing delta.');
      }
      break;
    case 'attachment.added':
    case 'attachment.ready':
    case 'attachment.failed':
    case 'attachment.removed':
      requireNonEmptyString(record, 'attachmentId');
      break;
    case 'artifact.added':
    case 'artifact.ready':
    case 'artifact.failed':
      requireNonEmptyString(record, 'artifactId');
      break;
    case 'state.snapshot':
    case 'ui.state.snapshot':
      requireEnum(record, 'scope', ['session', 'workflow', 'run'] as const);
      requireInteger(record, 'revision', 1);
      if (!('state' in record)) {
        throw new NaradClientError('invalid_record', 'Missing state.');
      }
      break;
    case 'state.delta':
    case 'ui.state.delta':
      requireEnum(record, 'scope', ['session', 'workflow', 'run'] as const);
      requireInteger(record, 'baseRevision', 0);
      requireInteger(record, 'revision', 1);
      if (!Array.isArray(record.patch)) {
        throw new NaradClientError('invalid_record', 'Missing patch.');
      }
      break;
    case 'state.compacted':
      requireEnum(record, 'scope', ['session', 'workflow', 'run'] as const);
      requireInteger(record, 'coversThroughSessionSequence', 0);
      requireInteger(record, 'snapshotRevision', 1);
      break;
    case 'view.opened':
    case 'view.closed':
      requireNonEmptyString(record, 'viewId');
      break;
    case 'view.updated':
      requireNonEmptyString(record, 'viewId');
      requireEnum(record, 'operation', ['replace', 'patch'] as const);
      if (record.operation === 'replace' && !('model' in record)) {
        throw new NaradClientError('invalid_record', 'Replace view update requires model.');
      }
      if (record.operation === 'patch' && !Array.isArray(record.patch)) {
        throw new NaradClientError('invalid_record', 'Patch view update requires patch.');
      }
      break;
    case 'progress.recorded':
      validateRunTreeFields(record);
      requireNonEmptyString(record, 'progressId');
      requireNonEmptyString(record, 'category');
      requireNonEmptyString(record, 'label');
      requireEnum(record, 'status', ['active', 'completed', 'failed', 'cancelled'] as const);
      requireEnum(record, 'privacy', ['public', 'internal', 'sensitive'] as const);
      break;
    case 'session.custom':
    case 'workflow.custom':
    case 'run.custom':
    case 'node.custom':
      requireNonEmptyString(record, 'name');
      if (!('value' in record)) {
        throw new NaradClientError('invalid_record', 'Missing value.');
      }
      break;
    case 'session.raw':
    case 'workflow.raw':
    case 'run.raw':
    case 'node.raw':
      requireNonEmptyString(record, 'contentType');
      if (typeof record.payload !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing payload.');
      }
      break;
    case 'trace.span.started':
    case 'trace.span.completed':
    case 'trace.event':
    case 'debug.log':
    case 'debug.snapshot':
      break;
    default:
      break;
  }
}

function validateProfileWatchShape(record: Record<string, unknown>): void {
  validateBaseEnvelope(record);
  requireNonEmptyString(record, 'sessionId');
  requireInteger(record, 'revision', 1);
  const type = String(record.type);
  if (type === 'node.revision') {
    requireNonEmptyString(record, 'workflowId');
    requireNonEmptyString(record, 'nodeId');
  } else {
    requireNonEmptyString(record, 'workflowId');
  }
}

function validateWorkspaceWatchShape(record: Record<string, unknown>): void {
  validateBaseEnvelope(record);
  requireNonEmptyString(record, 'workspaceId');
  requireInteger(record, 'revision', 1);
  const type = String(record.type);
  if (type === 'session.created' || type === 'session.updated' || type === 'session.archived') {
    requireNonEmptyString(record, 'sessionId');
  }
}

export function assertProfileAllowed(type: string, activeProfiles: readonly NaradProfileId[]): void {
  const profile = resolveProfileForEventType(type);
  if (profile === null) {
    throw new NaradClientError('unknown_event', 'Unknown event type.');
  }
  if (!activeProfiles.includes(profile)) {
    throw new NaradClientError('profile_not_negotiated', 'Event profile was not negotiated.');
  }
}

export function validateProfileAuthorityEvent(
  value: unknown,
  limits: NaradLimits,
  activeProfiles: readonly NaradProfileId[],
): Record<string, unknown> {
  const record = requireRecord(value);
  assertWithinLimits(record, limits);
  const type = requireNonEmptyString(record, 'type');
  if (!PROFILE_AUTHORITY_TYPES.has(type)) {
    throw new NaradClientError('unknown_event', 'Unsupported profile authority event.');
  }
  assertProfileAllowed(type, activeProfiles);
  validateProfileAuthorityShape(record);
  return record;
}

export function validateProfileWatchEvent(
  value: unknown,
  limits: NaradLimits,
  activeProfiles: readonly NaradProfileId[],
): Record<string, unknown> {
  const record = requireRecord(value);
  assertWithinLimits(record, limits);
  const type = requireNonEmptyString(record, 'type');

  if (WORKSPACE_WATCH_TYPES.has(type)) {
    assertProfileAllowed(type, activeProfiles);
    validateWorkspaceWatchShape(record);
    return record;
  }

  if (PROFILE_WATCH_TYPES.has(type)) {
    assertProfileAllowed(type, activeProfiles);
    validateProfileWatchShape(record);
    return record;
  }

  throw new NaradClientError('unknown_event', 'Unsupported profile watch event.');
}

export function isProfileAuthorityType(type: string): boolean {
  return PROFILE_AUTHORITY_TYPES.has(type);
}

export function isProfileWatchType(type: string): boolean {
  return PROFILE_WATCH_TYPES.has(type) || WORKSPACE_WATCH_TYPES.has(type);
}

export function allKnownProfileIds(): readonly NaradProfileId[] {
  return Object.values(NARAD_PROFILE_IDS);
}
