import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNaradReducer } from './reducer/index.js';
import { NARAD_PROFILE_IDS, NARAD_PROTOCOL_VERSION } from './types.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);
const ROOT_RUN_ID = 'b31655e180184aa4ae7061f8603487b3';
const SESSION_ID = 'session-b00201f70b6a480b91007ccc2a553f89';

/** Local forensic dump only — `.artifacts/` is gitignored and not produced in CI. */
const REPLAY_PATH = resolve(process.cwd(), '../../../../.artifacts/session-b002-replay.jsonl');
const HAS_REPLAY_DUMP = existsSync(REPLAY_PATH);

function dumpUsesCurrentProtocol(): boolean {
  if (!HAS_REPLAY_DUMP) {
    return false;
  }
  const first = readFileSync(REPLAY_PATH, 'utf8').split(/\r?\n/).find(Boolean);
  if (!first) {
    return false;
  }
  const event = JSON.parse(first) as { protocolVersion?: string };
  return event.protocolVersion === NARAD_PROTOCOL_VERSION;
}

function isNestedProjection(event: Record<string, unknown>): boolean {
  if (typeof event.sourceEventId === 'string') {
    return true;
  }
  const runId = typeof event.runId === 'string' ? event.runId : '';
  const rootRunId = typeof event.rootRunId === 'string' ? event.rootRunId : '';
  return runId.length > 0 && rootRunId.length > 0 && runId !== rootRunId;
}

/**
 * Reconstruct the parent lane a correct producer would have written:
 * drop parent authority run.finished(wait child) and parent run.resumed without
 * a matching open parent run.paused. Nested projections are kept.
 */
function scrubIllegalParentAaatAuthority(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const openParentWaits = new Set<string>();
  const kept: Record<string, unknown>[] = [];

  for (const event of events) {
    const type = String(event.type);
    const parentAuth = !isNestedProjection(event)
      && typeof event.runId === 'string'
      && event.runId === ROOT_RUN_ID;

    if (parentAuth && type === 'run.finished') {
      const result = event.result;
      if (typeof result === 'object' && result !== null) {
        const run = (result as Record<string, unknown>).run;
        if (typeof run === 'object' && run !== null) {
          const phase = (run as Record<string, unknown>).phase;
          const waitStateReason = (run as Record<string, unknown>).waitStateReason;
          if (phase === 'executing' && waitStateReason === 'child') {
            continue;
          }
        }
      }
    }

    if (parentAuth && type === 'run.resumed') {
      const waitId = typeof event.waitId === 'string' ? event.waitId : '';
      if (!waitId || !openParentWaits.has(waitId)) {
        continue;
      }
      openParentWaits.delete(waitId);
    }

    if (parentAuth && type === 'run.paused') {
      const waitId = typeof event.waitId === 'string' ? event.waitId : '';
      if (waitId) {
        openParentWaits.add(waitId);
      }
    }

    kept.push(event);
  }

  return kept.map((event, index) => ({
    ...event,
    sessionSequence: index + 1,
  }));
}

describe('real agent.db AAAT parent session replay', () => {
  it.skipIf(!HAS_REPLAY_DUMP || !dumpUsesCurrentProtocol())(
    'replays corrected parent lane (illegal AAAT authority scrubbed) without gap',
    () => {
      const raw = readFileSync(REPLAY_PATH, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      const cleaned = scrubIllegalParentAaatAuthority(raw);
      expect(cleaned.length).toBeLessThan(raw.length);

      const reducer = createNaradReducer({ sessionId: SESSION_ID, activeProfiles: ALL_PROFILES });
      for (const event of cleaned) {
        const result = reducer.apply(event);
        expect(result.gap, `${event.sessionSequence}:${event.type}:${event.eventId}:${result.error}`).toBe(false);
        expect(result.error ?? null, `${event.sessionSequence}:${event.type}:${result.error}`).toBeNull();
      }

      const snap = reducer.getSnapshot();
      expect(snap.sessionGap).toBe(false);
      expect(snap.lastSessionSequence).toBe(cleaned.length);
      expect(snap.runs.get(ROOT_RUN_ID)?.state).toBe('finished');
    },
  );
});
