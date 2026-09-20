import { NARAD_PROTOCOL_VERSION, type NaradLimits } from './types.js';
import { isRecord } from './wire.js';

export class NaradClientError extends Error {
  readonly code: string;
  readonly redacted: boolean;

  constructor(code: string, message: string, redacted = true) {
    super(message);
    this.name = 'NaradClientError';
    this.code = code;
    this.redacted = redacted;
  }
}

export function redactForPublicError(error: unknown): NaradClientError {
  if (error instanceof NaradClientError) {
    return error;
  }
  return new NaradClientError('internal_error', 'An internal client error occurred.');
}

const POLLUTION_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeJsonPointer(path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return false;
  }
  const segments = path.split('/').slice(1);
  for (const segment of segments) {
    const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (POLLUTION_SEGMENTS.has(decoded)) {
      return false;
    }
  }
  return true;
}

export function measureJsonDepth(value: unknown, limit: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.depth > limit) {
      return false;
    }
    if (current.value && typeof current.value === 'object') {
      if (Array.isArray(current.value)) {
        for (const item of current.value) {
          stack.push({ value: item, depth: current.depth + 1 });
        }
      } else {
        for (const item of Object.values(current.value as Record<string, unknown>)) {
          stack.push({ value: item, depth: current.depth + 1 });
        }
      }
    }
  }
  return true;
}

export function assertWithinLimits(value: unknown, limits: NaradLimits): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > limits.maxEventBytes) {
    throw new NaradClientError('event_too_large', 'Wire record exceeds maximum event size.');
  }
  if (!measureJsonDepth(value, limits.maxJsonDepth)) {
    throw new NaradClientError('json_depth_exceeded', 'Wire record exceeds maximum JSON depth.');
  }
}

export function requireProtocolVersion(record: Record<string, unknown>): void {
  if (record.protocolVersion !== NARAD_PROTOCOL_VERSION) {
    throw new NaradClientError('unsupported_protocol', 'Unsupported protocol version.');
  }
}

export function requireNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new NaradClientError('invalid_record', `Missing or invalid field: ${key}`);
  }
  return value;
}

export function requireInteger(record: Record<string, unknown>, key: string, minimum = 0): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new NaradClientError('invalid_record', `Missing or invalid field: ${key}`);
  }
  return value;
}

export function requireEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = record[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new NaradClientError('invalid_record', `Missing or invalid field: ${key}`);
  }
  return value as T;
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new NaradClientError('invalid_record', 'Expected JSON object.');
  }
  return value;
}

export const DOTTED_LOWERCASE_TYPE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

export function requireDottedLowercaseType(record: Record<string, unknown>, key = 'type'): string {
  const value = requireNonEmptyString(record, key);
  if (!DOTTED_LOWERCASE_TYPE.test(value)) {
    throw new NaradClientError('invalid_record', `Invalid dotted.lowercase type: ${key}`);
  }
  return value;
}

export function requireIsoDateTime(record: Record<string, unknown>, key: string): string {
  const value = requireNonEmptyString(record, key);
  if (Number.isNaN(Date.parse(value))) {
    throw new NaradClientError('invalid_record', `Invalid ISO-8601 timestamp: ${key}`);
  }
  return value;
}

export function sanitizeUserMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.slice(0, 4_096);
}
