import { describe, expect, it, vi } from 'vitest';
import { createClientExecutor } from './executor/clientExecutor.js';
import { readConformanceTrace } from './test/fixtures/conformanceTraces.js';

describe('createClientExecutor', () => {
  it('executes client.tool.execute once and deduplicates token redelivery', async () => {
    const finish = vi.fn(async () => {});
    const execute = vi.fn(async () => ({ opened: true }));
    const executor = createClientExecutor({
      handlers: [{ toolName: 'open.file', execute }],
      sendFinish: finish,
      now: () => new Date('2026-08-05T00:00:30Z'),
    });

    const lines = readConformanceTrace('client-tool.jsonl');
    for (const line of lines) {
      const message = JSON.parse(line) as unknown;
      if ((message as { type?: string }).type?.startsWith('client.')) {
        await executor.handleControl(message);
      }
    }

    expect(execute).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(executor.getSnapshot().inFlightToolCallIds).toEqual([]);
  });
});
