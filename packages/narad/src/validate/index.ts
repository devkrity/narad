import { NaradClientError } from '../security.js';
import type { NaradLimits, NaradProfileId } from '../types.js';
import { classifyWireRecord, resolveProfileForEventType } from '../wire.js';
import { validateCoreAuthorityEvent, validateCoreWatchEvent } from './core.js';
import { validateControlMessage } from './control.js';
import { validateHydrateRecord } from './hydrate.js';
import { validateProfileAuthorityEvent, validateProfileWatchEvent } from './profile.js';

export type ValidatedWireRecord =
  | ReturnType<typeof validateCoreAuthorityEvent>
  | ReturnType<typeof validateCoreWatchEvent>
  | ReturnType<typeof validateProfileAuthorityEvent>
  | ReturnType<typeof validateProfileWatchEvent>
  | ReturnType<typeof validateHydrateRecord>
  | ReturnType<typeof validateControlMessage>;

export { validateHydrateRecord } from './hydrate.js';

export function validateWireRecord(
  value: unknown,
  limits: NaradLimits,
  activeProfiles: readonly NaradProfileId[],
): ValidatedWireRecord {
  const wireClass = classifyWireRecord(value);
  switch (wireClass) {
    case 'control':
      return validateControlMessage(value, limits);
    case 'hydrate':
      return validateHydrateRecord(value, limits, activeProfiles);
    case 'watch': {
      const type = (value as Record<string, unknown>).type;
      if (typeof type !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing event type.');
      }
      const profile = resolveProfileForEventType(type);
      if (profile === null) {
        return validateCoreWatchEvent(value, limits);
      }
      return validateProfileWatchEvent(value, limits, activeProfiles);
    }
    case 'authority': {
      const type = (value as Record<string, unknown>).type;
      if (typeof type !== 'string') {
        throw new NaradClientError('invalid_record', 'Missing event type.');
      }
      const profile = resolveProfileForEventType(type);
      if (profile === null) {
        return validateCoreAuthorityEvent(value, limits);
      }
      return validateProfileAuthorityEvent(value, limits, activeProfiles);
    }
    default:
      throw new NaradClientError('unknown_record', 'Unknown wire record.');
  }
}

export function validateAuthorityEvent(
  value: unknown,
  limits: NaradLimits,
  activeProfiles: readonly NaradProfileId[],
): Record<string, unknown> {
  const wireClass = classifyWireRecord(value);
  if (wireClass === 'watch') {
    const type = (value as Record<string, unknown>).type;
    if (typeof type !== 'string') {
      throw new NaradClientError('invalid_record', 'Missing event type.');
    }
    const profile = resolveProfileForEventType(type);
    if (profile === null) {
      return validateCoreWatchEvent(value, limits);
    }
    return validateProfileWatchEvent(value, limits, activeProfiles);
  }
  if (wireClass !== 'authority') {
    throw new NaradClientError('invalid_record', 'Expected authority or watch event.');
  }
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== 'string') {
    throw new NaradClientError('invalid_record', 'Missing event type.');
  }
  const profile = resolveProfileForEventType(type);
  if (profile === null) {
    return validateCoreAuthorityEvent(value, limits);
  }
  return validateProfileAuthorityEvent(value, limits, activeProfiles);
}
