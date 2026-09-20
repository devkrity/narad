import { describe, expect, it, vi } from 'vitest';
import { createCommandClient } from './session/commands.js';

describe('createCommandClient', () => {
  it('posts spec-shaped resolve-interrupt', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'accepted', decision: 'approved', requestId: 'wrev-1' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createCommandClient({ baseUrl: '/api/narad/v1', fetch: fetchImpl });
    const result = await client.resolveInterrupt({ interruptId: 'wrev-1', decision: 'approve' });
    expect(result.status).toBe('accepted');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/narad/v1/commands/resolve-interrupt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          interruptId: 'wrev-1',
          decision: 'approve',
        }),
      }),
    );
  });
});
