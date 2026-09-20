export const NARAD_PROTOCOL_VERSION = 'narad/v1' as const;

export type NaradProtocolVersion = typeof NARAD_PROTOCOL_VERSION;

export const NARAD_PROFILE_IDS = {
  workflow: 'narad.workflow/v1',
  conversation: 'narad.conversation/v1',
  attachments: 'narad.attachments/v1',
  artifacts: 'narad.artifacts/v1',
  state: 'narad.state/v1',
  ui: 'narad.ui/v1',
  graph: 'narad.graph/v1',
  progress: 'narad.progress/v1',
  workspace: 'narad.workspace/v1',
  extensions: 'narad.extensions/v1',
  trace: 'narad.trace/v1',
  debug: 'narad.debug/v1',
} as const;

export type NaradProfileId = (typeof NARAD_PROFILE_IDS)[keyof typeof NARAD_PROFILE_IDS];

export type RunState = 'running' | 'paused' | 'finished' | 'error' | 'cancelled';

export type WorkflowState = 'running' | 'paused' | 'finished' | 'error' | 'cancelled';

export type ToolExecutor = 'backend' | 'client';

export type ToolOutcome = 'success' | 'error' | 'cancelled';

export type ProgressStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export type ProgressPrivacy = 'public' | 'internal' | 'sensitive';

export type ResumeMode = 'automatic' | 'command';

export type MessageScope = 'session' | 'workflow' | 'run';

export type StateScope = 'session' | 'workflow' | 'run';

export type GraphScope = 'run' | 'workflow';

export type WatchCursorKind = 'session' | 'workflow' | 'run';

export interface WatchCursor {
  readonly kind: WatchCursorKind;
  readonly sessionSequence?: number;
  readonly workflowId?: string;
  readonly workflowSequence?: number;
  readonly rootRunId?: string;
  readonly sequence?: number;
}

export interface NaradNegotiatedCapabilities {
  readonly protocolVersion: NaradProtocolVersion;
  readonly activeProfiles: readonly NaradProfileId[];
  readonly currentSessionSequence: number;
  readonly historyLimit?: number;
  readonly heartbeatIntervalMs?: number;
  readonly activeRootRunId?: string;
  readonly activeWorkflowId?: string;
}

export interface NaradLimits {
  readonly maxFrameBytes: number;
  readonly maxEventBytes: number;
  readonly maxJsonDepth: number;
  readonly maxHistoryEvents: number;
  readonly maxPendingQueue: number;
}

export const DEFAULT_NARAD_LIMITS: NaradLimits = {
  maxFrameBytes: 1_048_576,
  maxEventBytes: 512_000,
  maxJsonDepth: 64,
  maxHistoryEvents: 10_000,
  maxPendingQueue: 256,
};

/** Optional terminal token / duration envelope from Narad run lifecycle usage. */
export interface RunUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly elapsedMs?: number;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly rootRunId: string;
  readonly sessionId: string;
  readonly workflowId?: string;
  readonly parentRunId?: string;
  readonly parentToolCallId?: string;
  readonly clientExecutorId?: string;
  readonly state: RunState;
  readonly stopRequested: boolean;
  readonly openWaitId?: string;
  readonly openInterruptId?: string;
  readonly lastSequence: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly usage?: RunUsage;
}

export interface WorkflowStepSnapshot {
  readonly nodeId: string;
  readonly status: 'pending' | 'running' | 'finished' | 'failed' | 'cancelled';
  readonly runId?: string;
  readonly sessionId?: string;
  readonly attempt?: number;
}

export interface WorkflowSnapshot {
  readonly workflowId: string;
  readonly sessionId: string;
  readonly state: WorkflowState;
  readonly stopRequested: boolean;
  readonly currentNodeId?: string;
  readonly defaultClientExecutorId?: string;
  readonly lastWorkflowSequence: number;
  readonly openWaitId?: string;
  readonly openInterruptId?: string;
  readonly steps: ReadonlyMap<string, WorkflowStepSnapshot>;
}

export interface ToolCallSnapshot {
  readonly toolCallId: string;
  readonly runId: string;
  readonly rootRunId: string;
  readonly toolName: string;
  readonly executor: ToolExecutor;
  readonly args: unknown;
  /** AAAT / nested action parent; present when the journal event carried parentToolCallId. */
  readonly parentToolCallId?: string;
  readonly outcome?: ToolOutcome;
  readonly response?: unknown;
  readonly code?: string;
  readonly message?: string;
  readonly open: boolean;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface InterruptMemberSnapshot {
  readonly requestId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolType?: string;
  readonly decision?: string;
}

export interface InterruptSnapshot {
  readonly interruptId: string;
  readonly runId?: string;
  readonly rootRunId?: string;
  readonly workflowId?: string;
  readonly scope: 'run' | 'workflow';
  readonly waitId: string;
  readonly kind: string;
  readonly actions: readonly string[];
  readonly decision?: string;
  /** Per-member facts from packed `interrupt.resolved.members`. */
  readonly members?: readonly InterruptMemberSnapshot[];
  readonly open: boolean;
  readonly expiresAt?: string;
  readonly requestedAt?: string;
  /** When interrupt.resolved was applied (journal timestamp). */
  readonly resolvedAt?: string;
  readonly title?: string;
  readonly message?: string;
  readonly input?: unknown;
}

export interface ConversationMessageSnapshot {
  readonly messageId: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly messageScope?: MessageScope;
  readonly streaming?: boolean;
  readonly attachmentIds?: readonly string[];
  readonly redacted?: boolean;
  readonly displayReplacement?: string | null;
  readonly timestamp?: string;
  readonly sessionSequence?: number;
  readonly rootRunId?: string;
  readonly runId?: string;
}

export interface ReasoningSnapshot {
  readonly reasoningId: string;
  readonly messageId?: string;
  readonly content: string;
  readonly completed: boolean;
  readonly timestamp?: string;
}

export interface ConversationSnapshot {
  readonly messages: readonly ConversationMessageSnapshot[];
  readonly reasoning: readonly ReasoningSnapshot[];
  readonly coversThroughSessionSequence: number;
}

export interface GraphScopeSnapshot {
  readonly scope: GraphScope;
  readonly scopeKey: string;
  readonly sessionId: string;
  readonly rootRunId?: string;
  readonly workflowId?: string;
  readonly graphSchemaVersion: string;
  readonly revision: number;
  readonly sourceRunCursorSequence?: number;
  readonly rootNodeId?: string;
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly deltaGap: boolean;
  readonly resyncRequired: boolean;
}

export interface ProgressSnapshot {
  readonly progressId: string;
  readonly runId: string;
  readonly rootRunId: string;
  readonly category: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: ProgressStatus;
  readonly privacy: ProgressPrivacy;
  readonly recordedAt?: string;
  readonly updatedAt?: string;
  readonly usage?: RunUsage;
}

export interface AttachmentSnapshot {
  readonly attachmentId: string;
  readonly state: 'added' | 'ready' | 'failed' | 'removed';
  readonly code?: string;
  readonly message?: string;
}

export interface ArtifactSnapshot {
  readonly artifactId: string;
  readonly state: 'added' | 'ready' | 'failed';
  readonly code?: string;
  readonly message?: string;
}

export interface ScopedStateSnapshot {
  readonly scope: StateScope;
  readonly scopeKey: string;
  readonly revision: number;
  readonly state: unknown;
  readonly deltaGap: boolean;
  readonly resyncRequired: boolean;
}

export interface ViewSnapshot {
  readonly viewId: string;
  readonly open: boolean;
  readonly model?: unknown;
}

export interface WorkspaceSessionSnapshot {
  readonly sessionId: string;
  readonly archived: boolean;
}

export interface WorkspaceSnapshot {
  readonly workspaceId: string;
  readonly revision: number;
  readonly sessions: readonly WorkspaceSessionSnapshot[];
}

export interface NaradSessionSnapshot {
  readonly sessionId: string;
  readonly protocolVersion: NaradProtocolVersion;
  readonly activeProfiles: readonly NaradProfileId[];
  readonly lastSessionSequence: number;
  readonly sessionRevision: number | null;
  readonly sessionGap: boolean;
  readonly resyncRequired: boolean;
  readonly lastError: string | null;
  readonly activeRootRunId: string | null;
  readonly activeWorkflowId: string | null;
  readonly runs: ReadonlyMap<string, RunSnapshot>;
  readonly workflows: ReadonlyMap<string, WorkflowSnapshot>;
  readonly tools: ReadonlyMap<string, ToolCallSnapshot>;
  readonly interrupts: ReadonlyMap<string, InterruptSnapshot>;
  readonly conversation: ConversationSnapshot;
  readonly graphs: ReadonlyMap<string, GraphScopeSnapshot>;
  readonly progressByRun: ReadonlyMap<string, ReadonlyMap<string, ProgressSnapshot>>;
  readonly attachments: ReadonlyMap<string, AttachmentSnapshot>;
  readonly artifacts: ReadonlyMap<string, ArtifactSnapshot>;
  readonly scopedState: ReadonlyMap<string, ScopedStateSnapshot>;
  readonly uiState: ReadonlyMap<string, ScopedStateSnapshot>;
  readonly views: ReadonlyMap<string, ViewSnapshot>;
  readonly workspace: WorkspaceSnapshot | null;
  readonly runRevisions: ReadonlyMap<string, number>;
  readonly workflowRevisions: ReadonlyMap<string, number>;
  readonly nodeRevisions: ReadonlyMap<string, number>;
  readonly workflowGaps: ReadonlyMap<string, boolean>;
  readonly rootRunGaps: ReadonlyMap<string, boolean>;
}

export interface NaradExternalStore<TSnapshot> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TSnapshot;
}

export interface SessionHistoryPage {
  readonly events: readonly unknown[];
  readonly nextSessionSequence: number | null;
}

export interface NaradTransportAttachResult {
  readonly capabilities: NaradNegotiatedCapabilities;
  readonly boundarySessionSequence: number;
}

export interface NaradTransport {
  attach(sessionId: string, options?: { readonly claimedProfiles?: readonly NaradProfileId[] }): Promise<NaradTransportAttachResult>;
  subscribeLive(
    sessionId: string,
    afterSessionSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<unknown>;
  fetchHistory(
    sessionId: string,
    afterSessionSequence: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<SessionHistoryPage>;
  sendControl(message: unknown): Promise<void>;
  dispose(): void;
}

export interface IntentAcknowledgment {
  readonly accepted: boolean;
  readonly requestId: string;
  readonly reason?: string;
}

export interface ClientToolHandler {
  readonly toolName: string;
  execute(args: unknown, context: ClientToolExecutionContext): Promise<unknown> | unknown;
}

export interface ClientToolExecutionContext {
  readonly toolCallId: string;
  readonly executionToken: string;
  readonly signal: AbortSignal;
}

export interface ClientExecutorSnapshot {
  readonly clientExecutorId: string | null;
  readonly leaseId: string | null;
  readonly leaseExpiresAt: string | null;
  readonly heartbeatIntervalMs: number | null;
  readonly inFlightToolCallIds: readonly string[];
}

export interface SseParsedFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}

export interface ReducerApplyResult {
  readonly applied: boolean;
  readonly duplicate: boolean;
  readonly gap: boolean;
  readonly resyncRequired: boolean;
  readonly error?: string;
}

export interface AttachCoordinatorSnapshot {
  readonly attached: boolean;
  readonly backfilling: boolean;
  readonly live: boolean;
  readonly liveSubscribed: boolean;
  readonly pendingCount: number;
  readonly resyncRequired: boolean;
  readonly liveError: string | null;
}
