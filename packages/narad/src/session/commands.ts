export type NaradCommandStatus =
  | 'accepted'
  | 'already_applied'
  | 'not_found'
  | 'forbidden'
  | 'expired'
  | 'conflict'
  | 'unsupported'
  | 'rejected';

export type NaradCommandResult = Readonly<{
  status: NaradCommandStatus;
  decision?: string;
  requestId?: string;
  resolvedCount?: number;
  detail?: string;
}>;

export interface NaradCommandClient {
  resolveInterrupt(
    input: Readonly<{
      interruptId: string;
      decision: string;
      reason?: string;
      expectedRevision?: number | null;
    }>,
    signal?: AbortSignal,
  ): Promise<NaradCommandResult>;
}

export function createCommandClient(options: {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
}): NaradCommandClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch;

  return {
    async resolveInterrupt(input, signal) {
      if (!input.interruptId || !input.decision) {
        return {
          status: 'rejected',
          detail: 'interruptId and decision are required.',
        };
      }

      const response = await fetchImpl(`${baseUrl}/commands/resolve-interrupt`, {
        method: 'POST',
        credentials: 'include',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interruptId: input.interruptId,
          decision: input.decision,
          reason: input.reason,
          expectedRevision: typeof input.expectedRevision === 'number' ? input.expectedRevision : undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<NaradCommandResult>;
      if (!response.ok && !payload.status) {
        throw new Error(payload.detail ?? `Narad command failed (HTTP ${response.status}).`);
      }

      return {
        status: payload.status ?? 'rejected',
        decision: payload.decision,
        requestId: payload.requestId,
        resolvedCount: payload.resolvedCount,
        detail: payload.detail,
      };
    },
  };
}
