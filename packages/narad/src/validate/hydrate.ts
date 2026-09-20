import {
  NaradClientError,
  assertWithinLimits,
  requireEnum,
  requireInteger,
  requireIsoDateTime,
  requireNonEmptyString,
  requireProtocolVersion,
  requireRecord,
} from '../security.js';
import type { NaradLimits, NaradProfileId } from '../types.js';
import { NARAD_PROFILE_IDS } from '../types.js';
import { assertProfileAllowed } from './profile.js';

const AUTHORITY_ORDERING_FIELDS = [
  'eventId',
  'sessionSequence',
  'workflowSequence',
  'sequence',
  'runId',
] as const;

export type ValidatedMessagesSnapshotRecord = Record<string, unknown> & { readonly type: 'messages.snapshot' };
export type ValidatedGraphSnapshotRecord = Record<string, unknown> & { readonly type: 'graph.snapshot' };
export type ValidatedGraphDeltaRecord = Record<string, unknown> & { readonly type: 'graph.delta' };
export type ValidatedGraphHydrateRecord = ValidatedGraphSnapshotRecord | ValidatedGraphDeltaRecord;
export type ValidatedHydrateRecord =
  | ValidatedMessagesSnapshotRecord
  | ValidatedGraphHydrateRecord;

function forbidAuthorityOrderingFields(record: Record<string, unknown>): void {
  for (const forbidden of AUTHORITY_ORDERING_FIELDS) {
    if (forbidden in record) {
      throw new NaradClientError('invalid_hydrate', 'Hydrate record must not include authority ordering fields.');
    }
  }
}

function validateGraphHydrateShape(record: Record<string, unknown>): void {
  requireNonEmptyString(record, 'timestamp');
  requireIsoDateTime(record, 'timestamp');
  requireNonEmptyString(record, 'sessionId');
  requireEnum(record, 'scope', ['run', 'workflow'] as const);
  requireNonEmptyString(record, 'graphSchemaVersion');
  if (record.graphSchemaVersion !== NARAD_PROFILE_IDS.graph) {
    throw new NaradClientError('invalid_hydrate', 'Graph hydrate requires narad.graph/v1 schema version.');
  }

  const scope = String(record.scope);
  if (scope === 'run') {
    requireNonEmptyString(record, 'rootRunId');
    if (!record.sourceRunCursor || typeof record.sourceRunCursor !== 'object') {
      throw new NaradClientError('invalid_hydrate', 'Missing sourceRunCursor.');
    }
    requireInteger(record.sourceRunCursor as Record<string, unknown>, 'sequence', 1);
    if ('workflowId' in record) {
      throw new NaradClientError('invalid_hydrate', 'Run-scoped graph hydrate must not include workflowId.');
    }
  } else {
    requireNonEmptyString(record, 'workflowId');
    if ('rootRunId' in record || 'sourceRunCursor' in record) {
      throw new NaradClientError('invalid_hydrate', 'Workflow-scoped graph hydrate must not include run cursor fields.');
    }
  }
}

function validateGraphSnapshotRecord(record: Record<string, unknown>): ValidatedGraphSnapshotRecord {
  requireInteger(record, 'revision', 1);
  requireNonEmptyString(record, 'rootNodeId');
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new NaradClientError('invalid_hydrate', 'Missing graph nodes or edges.');
  }
  return record as ValidatedGraphSnapshotRecord;
}

function validateGraphDeltaRecord(record: Record<string, unknown>): ValidatedGraphDeltaRecord {
  requireInteger(record, 'baseRevision', 0);
  requireInteger(record, 'revision', 1);
  if (!Array.isArray(record.patch)) {
    throw new NaradClientError('invalid_hydrate', 'Missing patch.');
  }
  return record as ValidatedGraphDeltaRecord;
}

function validateGraphHydrateRecord(
  record: Record<string, unknown>,
  activeProfiles: readonly NaradProfileId[],
): ValidatedGraphHydrateRecord {
  assertProfileAllowed(String(record.type), activeProfiles);
  forbidAuthorityOrderingFields(record);
  validateGraphHydrateShape(record);
  if (record.type === 'graph.snapshot') {
    return validateGraphSnapshotRecord(record);
  }
  return validateGraphDeltaRecord(record);
}

function validateMessagesSnapshotRecord(record: Record<string, unknown>): ValidatedMessagesSnapshotRecord {
  for (const forbidden of ['eventId', 'sessionSequence', 'workflowSequence', 'sequence', 'revision'] as const) {
    if (forbidden in record) {
      throw new NaradClientError('invalid_hydrate', 'Hydrate record must not include authority fields.');
    }
  }
  requireNonEmptyString(record, 'timestamp');
  requireIsoDateTime(record, 'timestamp');
  requireNonEmptyString(record, 'snapshotId');
  requireNonEmptyString(record, 'sessionId');
  requireInteger(record, 'coversThroughSessionSequence', 0);
  if (!Array.isArray(record.messages)) {
    throw new NaradClientError('invalid_hydrate', 'Missing messages array.');
  }
  return record as ValidatedMessagesSnapshotRecord;
}

export function validateHydrateRecord(
  value: unknown,
  limits: NaradLimits,
  activeProfiles: readonly NaradProfileId[],
): ValidatedHydrateRecord {
  const record = requireRecord(value);
  assertWithinLimits(record, limits);
  requireProtocolVersion(record);
  const type = requireNonEmptyString(record, 'type');
  if (type === 'messages.snapshot') {
    return validateMessagesSnapshotRecord(record);
  }
  if (type === 'graph.snapshot' || type === 'graph.delta') {
    return validateGraphHydrateRecord(record, activeProfiles);
  }
  throw new NaradClientError('invalid_hydrate', 'Unsupported hydrate record type.');
}
