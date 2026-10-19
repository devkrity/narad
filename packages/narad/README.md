# @devkrity/narad

Make durable agent runs recoverable, inspectable, and safe to supervise with a framework-neutral client for the Narad journal protocol.

Narad records runs, workflows, nested agent activity, tool calls, and human decisions as ordered lifecycle events. The host remains the authority: clients reduce and replay its journal, send intent as commands, and execute side-effecting client tools only when explicitly targeted.

```sh
npm i @devkrity/narad @devkrity/narad-spec
```

Use `@devkrity/narad-spec` for the protocol schemas and conformance traces. See the [product spec sheet](../narad-spec/SPEC-SHEET.md) for the capability overview and package map.

## Main exports

- `createNaradReducer` / `createNaradClientStore` — pure session reducer with immutable snapshots
- `replayJsonlReducer` — apply a JSONL authority trace to a reducer
- `createExternalStore` — framework-neutral subscribe/getSnapshot store
- `createSseFrameParser` — incremental SSE frame parser with bounded frame size
- `createAttachCoordinator` — subscribe-before-backfill merge coordinator
- `createClientExecutor` — lease-fenced client tool execution
- `createCommandClient` — POSTs spec-shaped `resolve-interrupt` (never synthesizes authority)
- `validateWireRecord` — strict fail-closed wire validation with profile allowlisting

## Built for recovery

Attach coordination subscribes before backfill, merges buffered live events with history, and catches up after sequence gaps. Reducers rebuild the same state from the same journal. Historical tool-call events remain observational; targeted client-tool control uses leases and one-shot execution tokens to avoid replay-triggered repeats.

Approvals and other interrupts are tied to their open wait cycle, and the resolution is recorded in the host journal. Nested runs keep delegated work connected to its invoking run and tool call.
