# @devkrity/narad

Framework-neutral Narad client for deterministic authority reduction, replay, SSE parsing, subscribe-before-backfill attachment, and targeted client-tool execution.

Clients reduce an authority journal. They never append to it. User intent goes out as commands (`resolve-interrupt`); accepted effects come back as events. Packages are unpublished; pin from git as in the [repo README](../../README.md).

## Main exports

- `createNaradReducer` / `createNaradClientStore` — pure session reducer with immutable snapshots
- `replayJsonlReducer` — apply a JSONL authority trace to a reducer
- `createExternalStore` — framework-neutral subscribe/getSnapshot store
- `createSseFrameParser` — incremental SSE frame parser with bounded frame size
- `createAttachCoordinator` — subscribe-before-backfill merge coordinator
- `createClientExecutor` — lease-fenced client tool execution
- `createCommandClient` — POSTs spec-shaped `resolve-interrupt` (never synthesizes authority)
- `validateWireRecord` — strict fail-closed wire validation with profile allowlisting

Conformance traces are in `@devkrity/narad-spec` and consumed by package tests.
