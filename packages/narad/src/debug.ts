import { classifyWireRecord } from './wire.js';
import type { ReducerApplyResult } from './types.js';

export type NaradDebugChannel = 'apply' | 'sse' | 'coordinator' | 'transport' | 'intent' | 'snapshot';

let debugEnabled: boolean | null = null;
let globalInstalled = false;

function readStoredPreference(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem('narad:debug');
  } catch {
    return null;
  }
}

export function isNaradClientDebugEnabled(): boolean {
  if (debugEnabled !== null) {
    return debugEnabled;
  }
  const globalFlag = (globalThis as { __NARAD_DEBUG__?: boolean }).__NARAD_DEBUG__;
  if (globalFlag === true) {
    return true;
  }
  if (globalFlag === false) {
    return false;
  }
  const stored = readStoredPreference();
  if (stored === '0') {
    return false;
  }
  if (stored === '1') {
    return true;
  }
  return typeof window !== 'undefined';
}

export function setNaradClientDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('narad:debug', enabled ? '1' : '0');
    }
  } catch {
    // ignore storage failures
  }
  installNaradClientDebugGlobal();
}

export function installNaradClientDebugGlobal(): void {
  if (globalInstalled || typeof globalThis === 'undefined') {
    return;
  }
  globalInstalled = true;
  const target = globalThis as {
    __naradDebug?: {
      enabled: () => boolean;
      enable: () => void;
      disable: () => void;
    };
  };
  target.__naradDebug = {
    enabled: isNaradClientDebugEnabled,
    enable: () => setNaradClientDebugEnabled(true),
    disable: () => setNaradClientDebugEnabled(false),
  };
}

function summarizeRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return { wireClass: classifyWireRecord(value), raw: value };
  }
  const record = value as Record<string, unknown>;
  const body =
    typeof record.body === 'object' && record.body !== null
      ? (record.body as Record<string, unknown>)
      : null;
  const summary: Record<string, unknown> = {
    wireClass: classifyWireRecord(value),
    type: record.type ?? record.eventType ?? body?.type,
    eventId: record.eventId,
    sessionId: record.sessionId,
    sessionSequence: record.sessionSequence,
    runId: record.runId,
    rootRunId: record.rootRunId,
    sequence: record.sequence,
    revision: record.revision,
    baseRevision: record.baseRevision,
    coversThroughSessionSequence: record.coversThroughSessionSequence,
  };
  if (record.sourceRunCursor && typeof record.sourceRunCursor === 'object') {
    summary.sourceRunCursorSequence = (record.sourceRunCursor as Record<string, unknown>).sequence;
  }
  return summary;
}

function summarizeApplyResult(result: ReducerApplyResult): Record<string, unknown> {
  return {
    applied: result.applied,
    duplicate: result.duplicate,
    gap: result.gap,
    resyncRequired: result.resyncRequired,
    error: result.error ?? null,
  };
}

export function logNaradDebug(
  channel: NaradDebugChannel,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (!isNaradClientDebugEnabled()) {
    return;
  }
  installNaradClientDebugGlobal();
  const payload = detail ?? {};
  console.log(`[narad:${channel}]`, message, payload);
}

export function logNaradApply(value: unknown, result: ReducerApplyResult): void {
  if (!isNaradClientDebugEnabled()) {
    return;
  }
  installNaradClientDebugGlobal();
  const summary = summarizeRecord(value);
  const outcome = summarizeApplyResult(result);
  if (result.error) {
    // Sticky gap rejects every subsequent frame until catch-up; once-log as warn.
    if (result.error === 'Session gap active.') {
      console.warn('[narad:apply:gap-active]', summary, outcome);
      return;
    }
    console.error('[narad:apply:error]', summary, outcome, value);
    return;
  }
  if (result.gap || result.resyncRequired) {
    console.warn('[narad:apply:gap]', summary, outcome, value);
    return;
  }
  if (result.duplicate) {
    console.debug('[narad:apply:duplicate]', summary, value);
    return;
  }
  console.log('[narad:apply]', summary, outcome, value);
}

export function logNaradError(channel: NaradDebugChannel, message: string, error: unknown, detail?: Record<string, unknown>): void {
  if (!isNaradClientDebugEnabled()) {
    return;
  }
  installNaradClientDebugGlobal();
  console.error(`[narad:${channel}:error]`, message, {
    ...(detail ?? {}),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
  });
}

export function logNaradSse(record: unknown, frameMeta?: Record<string, unknown>): void {
  if (!isNaradClientDebugEnabled()) {
    return;
  }
  installNaradClientDebugGlobal();
  const wireClass = classifyWireRecord(record);
  if (wireClass === 'control') {
    console.debug('[narad:sse:control]', frameMeta ?? {}, record);
    return;
  }
  console.log('[narad:sse]', summarizeRecord(record), frameMeta ?? {}, record);
}

export function logNaradSnapshot(label: string, snapshot: Record<string, unknown>): void {
  if (!isNaradClientDebugEnabled()) {
    return;
  }
  installNaradClientDebugGlobal();
  console.log(`[narad:snapshot] ${label}`, snapshot);
}
