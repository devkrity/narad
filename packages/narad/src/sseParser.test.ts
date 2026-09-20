import { describe, expect, it } from 'vitest';
import { createSseFrameParser, parseSseFrameData, validateSseAuthorityFrameId } from './transport/sseParser.js';
import { NaradClientError } from './security.js';

describe('createSseFrameParser', () => {
  it('parses fragmented SSE frames', () => {
    const parser = createSseFrameParser();
    const part1 = parser.push('id: evt-1\nevent: message\n');
    expect(part1).toEqual([]);
    const part2 = parser.push('data: {"type":"run.started","eventId":"evt-1"}\n\n');
    expect(part2).toHaveLength(1);
    expect(part2[0]?.id).toBe('evt-1');
    expect(parseSseFrameData(part2[0]!)).toEqual({ type: 'run.started', eventId: 'evt-1' });
    expect(() => validateSseAuthorityFrameId(part2[0]!, { type: 'run.started', eventId: 'evt-1' })).not.toThrow();
  });

  it('rejects frames exceeding max size', () => {
    const parser = createSseFrameParser({ limits: { maxFrameBytes: 16, maxEventBytes: 16, maxJsonDepth: 8, maxHistoryEvents: 100, maxPendingQueue: 10 } });
    expect(() => parser.push(`data: ${'x'.repeat(32)}\n\n`)).toThrow(NaradClientError);
  });
});
