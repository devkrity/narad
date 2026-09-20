import { describe, expect, it } from 'vitest';
import { validateWireRecord } from './validate/index.js';
import { validateProfileAuthorityEvent, assertProfileAllowed } from './validate/profile.js';
import { NaradClientError } from './security.js';
import { DEFAULT_NARAD_LIMITS, NARAD_PROFILE_IDS } from './types.js';
import { parseJsonPatchOperations } from './jsonPatch.js';

describe('wire validation fail-closed', () => {
  it('rejects malformed authority records', () => {
    expect(() =>
      validateWireRecord({ type: 'run.started', protocolVersion: 'narad/v1' }, DEFAULT_NARAD_LIMITS, []),
    ).toThrow(NaradClientError);
  });

  it('rejects events from unnegotiated profiles', () => {
    expect(() =>
      validateProfileAuthorityEvent(
        {
          type: 'progress.recorded',
          protocolVersion: 'narad/v1',
          eventId: 'e1',
          timestamp: '2026-08-05T00:00:00Z',
          sessionId: 's1',
          sessionSequence: 1,
          rootRunId: 'r1',
          runId: 'r1',
          sequence: 1,
          progressId: 'p1',
          category: 'phase',
          label: 'x',
          status: 'active',
          privacy: 'public',
        },
        DEFAULT_NARAD_LIMITS,
        [],
      ),
    ).toThrow(NaradClientError);
  });

  it('blocks prototype pollution patch paths', () => {
    expect(() => parseJsonPatchOperations([{ op: 'add', path: '/__proto__/polluted', value: true }])).toThrow(
      NaradClientError,
    );
  });

  it('allowlists negotiated profiles', () => {
    expect(() => assertProfileAllowed('progress.recorded', [NARAD_PROFILE_IDS.progress])).not.toThrow();
  });
});
