import { describe, expect, it } from 'vitest';
import {
  createSseFrameParser,
  parseJsonPatchOperations,
  parseSseFrameData,
  validateSseAuthorityFrameId,
  validateWireRecord,
  NaradClientError,
  redactForPublicError,
} from './index.js';
import { NARAD_PROFILE_IDS, DEFAULT_NARAD_LIMITS } from './types.js';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

describe('Narad client security release gates', () => {
  it('rejects truncated SSE JSON payloads', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: {"type":"run.started","eventId":"evt-1"\n\n');
    expect(() => parseSseFrameData(frames[0]!)).toThrow();
  });

  it('rejects oversized SSE frames before reducer mutation', () => {
    const parser = createSseFrameParser({
      limits: {
        maxFrameBytes: 32,
        maxEventBytes: 32,
        maxJsonDepth: 8,
        maxHistoryEvents: 100,
        maxPendingQueue: 8,
      },
    });
    expect(() => parser.push(`data: ${'x'.repeat(64)}\n\n`)).toThrow(NaradClientError);
  });

  it('rejects authority SSE frames without event id', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: {"type":"run.started","eventId":"evt-1"}\n\n');
    expect(() =>
      validateSseAuthorityFrameId(frames[0]!, {
        type: 'run.started',
        eventId: 'evt-1',
      }),
    ).toThrow(/requires id/i);
  });

  it('blocks JSON Patch prototype pollution paths and unsupported ops', () => {
    expect(() =>
      parseJsonPatchOperations([{ op: 'add', path: '/__proto__/polluted', value: true }]),
    ).toThrow(NaradClientError);
    expect(() => parseJsonPatchOperations([{ op: 'invoke', path: '/safe', value: 1 }])).toThrow(NaradClientError);
  });

  it('fails closed on unnegotiated profile types before reducer mutation', () => {
    expect(() =>
      validateWireRecord(
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

  it('rejects excessive JSON depth before mutation', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < DEFAULT_NARAD_LIMITS.maxJsonDepth + 4; depth += 1) {
      nested = { child: nested };
    }
    expect(() =>
      validateWireRecord(
        {
          type: 'run.started',
          protocolVersion: 'narad/v1',
          eventId: 'deep',
          timestamp: '2026-08-05T00:00:00Z',
          sessionId: 's1',
          sessionSequence: 1,
          rootRunId: 'r1',
          runId: 'r1',
          sequence: 1,
          payload: nested,
        },
        DEFAULT_NARAD_LIMITS,
        ALL_PROFILES,
      ),
    ).toThrow(NaradClientError);
  });

  it('redacts internal errors for public surfaces', () => {
    const redacted = redactForPublicError(new Error('lease secret=abc123'));
    expect(redacted.message).not.toContain('abc123');
    expect(redacted.redacted).toBe(true);
  });
});
