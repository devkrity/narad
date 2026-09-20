import { NaradClientError, assertWithinLimits, requireEnum, requireNonEmptyString, requireProtocolVersion, requireRecord } from '../security.js';
import type { NaradLimits } from '../types.js';
import { isRecord } from '../wire.js';

const CONTROL_TYPES = [
  'client.attached',
  'server.heartbeat',
  'client.heartbeat',
  'client.tool.execute',
  'client.tool.finish',
] as const;

export type ValidatedControlMessage = Record<string, unknown> & { readonly type: (typeof CONTROL_TYPES)[number] };

export function validateControlMessage(value: unknown, limits: NaradLimits): ValidatedControlMessage {
  const record = requireRecord(value);
  assertWithinLimits(record, limits);
  requireProtocolVersion(record);
  const type = requireEnum(record, 'type', CONTROL_TYPES);

  for (const forbidden of ['eventId', 'sessionSequence', 'workflowSequence', 'sequence', 'revision'] as const) {
    if (forbidden in record) {
      throw new NaradClientError('invalid_control', 'Control message must not include authority fields.');
    }
  }

  switch (type) {
    case 'client.attached':
      requireNonEmptyString(record, 'clientExecutorId');
      requireNonEmptyString(record, 'leaseId');
      if (typeof record.heartbeatIntervalMs !== 'number' || record.heartbeatIntervalMs < 1) {
        throw new NaradClientError('invalid_control', 'Missing heartbeatIntervalMs.');
      }
      requireNonEmptyString(record, 'leaseExpiresAt');
      break;
    case 'client.heartbeat':
      requireNonEmptyString(record, 'clientExecutorId');
      requireNonEmptyString(record, 'leaseId');
      break;
    case 'client.tool.execute':
      requireNonEmptyString(record, 'clientExecutorId');
      requireNonEmptyString(record, 'leaseId');
      requireNonEmptyString(record, 'executionToken');
      requireNonEmptyString(record, 'executionTokenExpiresAt');
      requireNonEmptyString(record, 'toolCallId');
      requireNonEmptyString(record, 'toolName');
      if (!('args' in record)) {
        throw new NaradClientError('invalid_control', 'Missing args.');
      }
      break;
    case 'client.tool.finish':
      requireNonEmptyString(record, 'clientExecutorId');
      requireNonEmptyString(record, 'leaseId');
      requireNonEmptyString(record, 'executionToken');
      requireNonEmptyString(record, 'toolCallId');
      requireEnum(record, 'outcome', ['success', 'error', 'cancelled'] as const);
      if (!('response' in record)) {
        throw new NaradClientError('invalid_control', 'Missing response.');
      }
      break;
    case 'server.heartbeat':
      break;
    default:
      throw new NaradClientError('invalid_control', 'Unknown control type.');
  }

  return record as unknown as ValidatedControlMessage;
}

export function isControlMessage(value: unknown): value is ValidatedControlMessage {
  return isRecord(value) && typeof value.type === 'string' && (CONTROL_TYPES as readonly string[]).includes(value.type);
}
