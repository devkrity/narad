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
import type { NaradLimits } from '../types.js';
import { resolveProfileForEventType } from '../wire.js';

const CORE_AUTHORITY_TYPES = [
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
] as const;

const CORE_WATCH_TYPES = ['session.revision', 'run.revision'] as const;

export type CoreAuthorityType = (typeof CORE_AUTHORITY_TYPES)[number];
export type CoreWatchType = (typeof CORE_WATCH_TYPES)[number];

export type ValidatedCoreAuthorityEvent = Record<string, unknown> & { readonly type: CoreAuthorityType };
export type ValidatedCoreWatchEvent = Record<string, unknown> & { readonly type: CoreWatchType };

function validateBaseEnvelope(record: Record<string, unknown>): void {
  requireDottedLowercaseType(record, 'type');
  requireProtocolVersion(record);
  requireNonEmptyString(record, 'eventId');
  requireIsoDateTime(record, 'timestamp');
}

function validateSessionAuthorityFields(record: Record<string, unknown>): void {
  requireNonEmptyString(record, 'sessionId');
  requireInteger(record, 'sessionSequence', 1);
  const hasWorkflowId = typeof record.workflowId === 'string' && record.workflowId.length > 0;
  const hasWorkflowSequence = typeof record.workflowSequence === 'number';
  if (hasWorkflowId !== hasWorkflowSequence) {
    throw new NaradClientError('invalid_record', 'workflowId and workflowSequence must appear together.');
  }
  if (hasWorkflowId) {
    requireInteger(record, 'workflowSequence', 1);
  }
}

function isParentConversationProjection(record: Record<string, unknown>): boolean {
  return typeof record.sourceEventId === 'string' && record.sourceEventId.length > 0;
}

function validateRunAuthorityFields(record: Record<string, unknown>): void {
  validateSessionAuthorityFields(record);
  requireNonEmptyString(record, 'rootRunId');
  requireNonEmptyString(record, 'runId');
  // Session-lane AAAT projections keep lineage ids but are not run-tree authority.
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

function validateCoreAuthorityShape(record: Record<string, unknown>, type: CoreAuthorityType): void {
  validateBaseEnvelope(record);
  const workflowScope =
    (type === 'interrupt.requested' || type === 'interrupt.resolved') && record.scope === 'workflow';
  if (workflowScope) {
    validateSessionAuthorityFields(record);
    requireNonEmptyString(record, 'workflowId');
    requireInteger(record, 'workflowSequence', 1);
    if ('runId' in record || 'rootRunId' in record || 'sequence' in record) {
      throw new NaradClientError(
        'invalid_record',
        'Workflow-scope interrupt must not carry run-tree fields.',
      );
    }
  } else {
    validateRunAuthorityFields(record);
  }

  switch (type) {
    case 'run.paused':
      requireNonEmptyString(record, 'waitId');
      requireNonEmptyString(record, 'reason');
      requireEnum(record, 'resumeMode', ['automatic', 'command'] as const);
      break;
    case 'run.resumed':
      requireNonEmptyString(record, 'waitId');
      break;
    case 'run.stop.requested':
      requireNonEmptyString(record, 'targetRunId');
      break;
    case 'run.error':
      requireNonEmptyString(record, 'code');
      if (typeof record.message !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing message.');
      }
      break;
    case 'interrupt.requested':
      requireNonEmptyString(record, 'interruptId');
      requireNonEmptyString(record, 'waitId');
      requireNonEmptyString(record, 'kind');
      if ('scope' in record) {
        requireEnum(record, 'scope', ['run', 'workflow'] as const);
      }
      if (!Array.isArray(record.actions) || record.actions.length === 0) {
        throw new NaradClientError('invalid_record', 'Missing actions.');
      }
      break;
    case 'interrupt.resolved':
      requireNonEmptyString(record, 'interruptId');
      requireNonEmptyString(record, 'waitId');
      requireNonEmptyString(record, 'decision');
      break;
    case 'tool.call.started':
      requireNonEmptyString(record, 'toolCallId');
      requireNonEmptyString(record, 'toolName');
      requireEnum(record, 'executor', ['backend', 'client'] as const);
      if (!('args' in record)) {
        throw new NaradClientError('invalid_record', 'Missing args.');
      }
      break;
    case 'tool.call.finished':
      requireNonEmptyString(record, 'toolCallId');
      requireEnum(record, 'outcome', ['success', 'error', 'cancelled'] as const);
      if (!('response' in record)) {
        throw new NaradClientError('invalid_record', 'Missing response.');
      }
      break;
    default:
      break;
  }
}

function validateCoreWatchShape(record: Record<string, unknown>, type: CoreWatchType): void {
  validateBaseEnvelope(record);
  requireNonEmptyString(record, 'sessionId');
  requireInteger(record, 'revision', 1);
  if (type === 'run.revision') {
    requireNonEmptyString(record, 'rootRunId');
    requireNonEmptyString(record, 'runId');
  }
}

export function validateCoreAuthorityEvent(value: unknown, limits: NaradLimits): ValidatedCoreAuthorityEvent {
  const record = requireRecord(value);
  assertWithinLimits(record, limits);
  const type = requireEnum(record, 'type', CORE_AUTHORITY_TYPES);
  if (resolveProfileForEventType(type) !== null) {
    throw new NaradClientError('invalid_record', 'Core validator received profile event.');
  }
  validateCoreAuthorityShape(record, type);
  return record as ValidatedCoreAuthorityEvent;
}

export function validateCoreWatchEvent(value: unknown, limits: NaradLimits): ValidatedCoreWatchEvent {
  const record = requireRecord(value);
  assertWithinLimits(record, limits);
  const type = requireEnum(record, 'type', CORE_WATCH_TYPES);
  validateCoreWatchShape(record, type);
  return record as ValidatedCoreWatchEvent;
}

export function isCoreAuthorityEvent(value: unknown): value is ValidatedCoreAuthorityEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as Record<string, unknown>).type;
  return typeof type === 'string' && (CORE_AUTHORITY_TYPES as readonly string[]).includes(type);
}

export function isCoreWatchEvent(value: unknown): value is ValidatedCoreWatchEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as Record<string, unknown>).type;
  return typeof type === 'string' && (CORE_WATCH_TYPES as readonly string[]).includes(type);
}

export { CORE_AUTHORITY_TYPES, CORE_WATCH_TYPES };
