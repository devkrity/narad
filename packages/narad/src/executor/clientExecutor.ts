import { NaradClientError } from '../security.js';
import type {
  ClientExecutorSnapshot,
  ClientToolExecutionContext,
  ClientToolHandler,
  ToolOutcome,
} from '../types.js';
import { validateControlMessage } from '../validate/control.js';
import { DEFAULT_NARAD_LIMITS } from '../types.js';

export interface ClientExecutorOptions {
  readonly handlers?: readonly ClientToolHandler[];
  readonly catalog?: ReadonlyMap<string, ClientToolHandler>;
  readonly sendFinish: (message: Record<string, unknown>) => Promise<void>;
  readonly now?: () => Date;
  readonly maxFinishedTokens?: number;
}

interface AcceptedToken {
  readonly executionToken: string;
  readonly leaseId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly expiresAtMs: number;
  readonly finish?: { outcome: ToolOutcome; response: unknown };
}

export interface ClientExecutor {
  handleControl(message: unknown): Promise<void>;
  cancelToolExecution(toolCallId: string): boolean;
  getSnapshot(): ClientExecutorSnapshot;
  dispose(): void;
}

export function createClientExecutor(options: ClientExecutorOptions): ClientExecutor {
  const now = options.now ?? (() => new Date());
  const maxFinishedTokens = options.maxFinishedTokens ?? DEFAULT_NARAD_LIMITS.maxHistoryEvents;
  const acceptedTokens = new Map<string, AcceptedToken>();
  const inFlight = new Set<string>();
  const abortControllers = new Map<string, AbortController>();
  let clientExecutorId: string | null = null;
  let leaseId: string | null = null;
  let leaseExpiresAt: string | null = null;
  let heartbeatIntervalMs: number | null = null;
  let disposed = false;

  function resolveHandler(toolName: string): ClientToolHandler | null {
    const explicit = options.handlers?.find((handler) => handler.toolName === toolName);
    if (explicit) return explicit;
    return options.catalog?.get(toolName) ?? null;
  }

  function isLeaseActive(messageLeaseId: string): boolean {
    if (!leaseId) return false;
    if (messageLeaseId === leaseId) {
      if (leaseExpiresAt && now().getTime() > Date.parse(leaseExpiresAt)) {
        return false;
      }
      return true;
    }
    return false;
  }

  function trimFinishedTokens(): void {
    const finished = [...acceptedTokens.entries()].filter(([, token]) => token.finish);
    while (finished.length > maxFinishedTokens) {
      const [tokenId] = finished.shift()!;
      acceptedTokens.delete(tokenId);
    }
  }

  async function submitFinish(token: AcceptedToken, outcome: ToolOutcome, response: unknown): Promise<void> {
    acceptedTokens.set(token.executionToken, { ...token, finish: { outcome, response } });
    trimFinishedTokens();
    await options.sendFinish({
      type: 'client.tool.finish',
      protocolVersion: 'narad/v1',
      clientExecutorId: clientExecutorId ?? '',
      leaseId: token.leaseId,
      executionToken: token.executionToken,
      toolCallId: token.toolCallId,
      outcome,
      response,
    });
    inFlight.delete(token.toolCallId);
    abortControllers.delete(token.toolCallId);
  }

  return {
    async handleControl(message: unknown): Promise<void> {
      if (disposed) {
        throw new NaradClientError('executor_disposed', 'Client executor disposed.');
      }
      const control = validateControlMessage(message, DEFAULT_NARAD_LIMITS);
      switch (control.type) {
        case 'client.attached':
          clientExecutorId = String(control.clientExecutorId);
          leaseId = String(control.leaseId);
          leaseExpiresAt = String(control.leaseExpiresAt);
          heartbeatIntervalMs = Number(control.heartbeatIntervalMs);
          return;
        case 'client.heartbeat':
          if (String(control.clientExecutorId) !== clientExecutorId) {
            throw new NaradClientError('executor_mismatch', 'Heartbeat clientExecutorId mismatch.');
          }
          if (!isLeaseActive(String(control.leaseId))) {
            throw new NaradClientError('stale_lease', 'Heartbeat rejected for stale lease.');
          }
          return;
        case 'client.tool.execute': {
          if (String(control.clientExecutorId) !== clientExecutorId) {
            throw new NaradClientError('executor_mismatch', 'Execution clientExecutorId mismatch.');
          }
          const token = String(control.executionToken);
          const existing = acceptedTokens.get(token);
          if (existing?.finish || existing) {
            return;
          }
          const messageLeaseId = String(control.leaseId);
          if (!isLeaseActive(messageLeaseId)) {
            throw new NaradClientError('stale_lease', 'Execution rejected for stale lease.');
          }
          const expiresAtMs = Date.parse(String(control.executionTokenExpiresAt));
          if (Number.isNaN(expiresAtMs) || now().getTime() > expiresAtMs) {
            throw new NaradClientError('token_expired', 'Execution token expired.');
          }
          const toolName = String(control.toolName);
          const handler = resolveHandler(toolName);
          if (!handler) {
            throw new NaradClientError('unknown_tool', 'No handler registered for tool.');
          }
          const toolCallId = String(control.toolCallId);
          const accepted: AcceptedToken = {
            executionToken: token,
            leaseId: messageLeaseId,
            toolCallId,
            toolName,
            args: control.args,
            expiresAtMs,
          };
          acceptedTokens.set(token, accepted);
          inFlight.add(toolCallId);
          const abortController = new AbortController();
          abortControllers.set(toolCallId, abortController);
          const context: ClientToolExecutionContext = {
            toolCallId,
            executionToken: token,
            signal: abortController.signal,
          };
          try {
            const response = await handler.execute(control.args, context);
            await submitFinish(accepted, 'success', response ?? null);
          } catch (error) {
            if (abortController.signal.aborted) {
              await submitFinish(accepted, 'cancelled', null);
              return;
            }
            await submitFinish(accepted, 'error', {
              code: error instanceof NaradClientError ? error.code : 'execution_failed',
            });
          }
          return;
        }
        case 'client.tool.finish':
          return;
        case 'server.heartbeat':
          return;
        default:
          throw new NaradClientError('unknown_control', 'Unsupported control message.');
      }
    },
    cancelToolExecution(toolCallId: string): boolean {
      const controller = abortControllers.get(toolCallId);
      if (!controller) {
        return false;
      }
      controller.abort();
      return true;
    },
    getSnapshot(): ClientExecutorSnapshot {
      return {
        clientExecutorId,
        leaseId,
        leaseExpiresAt,
        heartbeatIntervalMs,
        inFlightToolCallIds: [...inFlight],
      };
    },
    dispose(): void {
      disposed = true;
      for (const controller of abortControllers.values()) {
        controller.abort();
      }
      abortControllers.clear();
      inFlight.clear();
    },
  };
}
