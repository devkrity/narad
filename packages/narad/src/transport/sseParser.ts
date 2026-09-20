import { NaradClientError } from '../security.js';
import type { NaradLimits, SseParsedFrame } from '../types.js';
import { DEFAULT_NARAD_LIMITS } from '../types.js';
import { classifyWireRecord } from '../wire.js';
import { requireRecord } from '../security.js';

export interface SseParserOptions {
  readonly limits?: NaradLimits;
}

export interface SseParser {
  push(chunk: string): SseParsedFrame[];
  reset(): void;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createSseFrameParser(options: SseParserOptions = {}): SseParser {
  const limits = options.limits ?? DEFAULT_NARAD_LIMITS;
  let buffer = '';
  let currentId: string | undefined;
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  function flushFrame(): SseParsedFrame | null {
    if (dataLines.length === 0 && !currentId && !currentEvent) {
      return null;
    }
    const data = dataLines.join('\n');
    const frameBytes = byteLength(data);
    if (frameBytes > limits.maxFrameBytes) {
      throw new NaradClientError('frame_too_large', 'SSE frame exceeds maximum size.');
    }
    const frame: SseParsedFrame = { data, id: currentId, event: currentEvent };
    currentId = undefined;
    currentEvent = undefined;
    dataLines = [];
    return frame;
  }

  return {
    push(chunk: string): SseParsedFrame[] {
      buffer += chunk;
      const frames: SseParsedFrame[] = [];
      let lineBreakIndex = buffer.indexOf('\n');
      while (lineBreakIndex !== -1) {
        let line = buffer.slice(0, lineBreakIndex);
        buffer = buffer.slice(lineBreakIndex + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        if (line === '') {
          const frame = flushFrame();
          if (frame) {
            frames.push(frame);
          }
        } else if (line.startsWith(':')) {
          // comment
        } else {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) {
            value = value.slice(1);
          }
          if (field === 'id') currentId = value;
          else if (field === 'event') currentEvent = value;
          else if (field === 'data') dataLines.push(value);
        }
        lineBreakIndex = buffer.indexOf('\n');
      }
      if (byteLength(buffer) > limits.maxFrameBytes) {
        throw new NaradClientError('frame_too_large', 'SSE parser buffer exceeds maximum size.');
      }
      return frames;
    },
    reset(): void {
      buffer = '';
      currentId = undefined;
      currentEvent = undefined;
      dataLines = [];
    },
  };
}

export function parseSseFrameData(frame: SseParsedFrame): unknown {
  if (!frame.data) {
    throw new NaradClientError('invalid_frame', 'SSE frame data is empty.');
  }
  return JSON.parse(frame.data) as unknown;
}

export function validateSseAuthorityFrameId(frame: SseParsedFrame, record: unknown): void {
  const wireClass = classifyWireRecord(record);
  if (wireClass !== 'authority' && wireClass !== 'watch') {
    return;
  }
  const obj = requireRecord(record);
  if (typeof obj.eventId !== 'string') {
    throw new NaradClientError('invalid_frame', 'Authority/watch SSE frame requires event id.');
  }
  if (!frame.id) {
    throw new NaradClientError('invalid_frame', 'Authority/watch SSE frame requires id field.');
  }
  if (frame.id !== obj.eventId) {
    throw new NaradClientError('frame_id_mismatch', 'SSE frame id must equal eventId.');
  }
}
