import type { NaradLimits } from '../types.js';
import { NaradClientError } from '../security.js';

export interface EventFingerprintEntry {
  readonly fingerprint: string;
  readonly sessionSequence: number;
}

export function canonicalEventFingerprint(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

export function checkEventIdentity(
  store: Map<string, EventFingerprintEntry>,
  dedupKey: string,
  eventId: string,
  event: Record<string, unknown>,
  sessionSequence: number,
  limits: NaradLimits,
): 'new' | 'duplicate' | 'conflict' {
  const fingerprint = canonicalEventFingerprint(event);
  const existing = store.get(dedupKey);
  if (!existing) {
    return 'new';
  }
  if (existing.fingerprint === fingerprint) {
    return 'duplicate';
  }
  throw new NaradClientError(
    'event_identity_conflict',
    `Event identity conflict for eventId "${eventId}".`,
  );
}

export function commitEventFingerprint(
  store: Map<string, EventFingerprintEntry>,
  dedupKey: string,
  event: Record<string, unknown>,
  sessionSequence: number,
  limits: NaradLimits,
): void {
  while (store.size >= limits.maxHistoryEvents) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    store.delete(oldest);
  }
  store.set(dedupKey, {
    fingerprint: canonicalEventFingerprint(event),
    sessionSequence,
  });
}

export function sessionDedupKey(sessionId: string, eventId: string): string {
  return `${sessionId}:${eventId}`;
}

export function workspaceDedupKey(workspaceId: string, eventId: string): string {
  return `${workspaceId}:${eventId}`;
}
