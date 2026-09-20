# @devkrity/narad

Framework-neutral Narad client for deterministic authority reduction, replay, SSE parsing, subscribe-before-backfill attachment, and targeted client-tool execution.

## Public API

- `createNaradReducer` / `createNaradClientStore` — pure session reducer with immutable snapshots
- `createExternalStore` — framework-neutral subscribe/getSnapshot store
- `createSseFrameParser` — incremental SSE frame parser with bounded frame size
- `createAttachCoordinator` — subscribe-before-backfill merge coordinator
- `createClientExecutor` — lease-fenced client tool execution
- `createCommandClient` — POSTs spec-shaped `resolve-interrupt` (never synthesizes authority)
- `validateWireRecord` — strict fail-closed wire validation with profile allowlisting

Conformance traces are in `@devkrity/narad-spec` and consumed by package tests.
