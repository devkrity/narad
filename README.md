# Narad

Narad is a journal protocol for agent sessions. The backend appends facts, clients reduce them, and user intent goes back as commands.

Wire id: `narad/v1`. Speak: *NAH-rud*. Spell **Narad**, never Narada.

`0.1.0-alpha.1`. Requires Node 22+ and pnpm 11.5.2. License: [MIT](./LICENSE).

## What Narad is

Narad is a transport-neutral protocol for durable agent sessions: runs, workflows, tool calls, interrupts, conversation, and client-side execution, recorded as an ordered journal of authority events that only the backend appends. A client never writes to that journal; it reduces it, and any client that replays the same journal from zero lands in the same state. Intent enters as commands (`message`, `resolve-interrupt`, `stop-active-root`) and the accepted effect comes back as an event.

Four kinds of wire data ([spec §2](packages/narad-spec/narad-v1.md#2-design-model)):

- **Authority events** — immutable facts. They reconstruct session state.
- **Watch events** — this scope changed; catch up. They do not replace history.
- **Hydrate records** — derived projections (transcript, graph) anchored to an authority cursor.
- **Control messages** — attach, heartbeat, and targeted client-tool execution. Not journal.

Receiving an authority event does not trigger a client-side side effect.

```text
Chat / Approvals UI
        │  commands (resolve-interrupt, stop-active-root, message)
        ▼
Host accepts or rejects
        │  append facts
        ▼
Authority journal
        │  attach, history, live
        ▼
Stateless reducers  →  chat, interrupts, graph
```

## What breaks without it

**Reload loses the run.** A stream's client state is the frames it happened to receive. Narad delivers at least once, deduplicates on `(sessionId, eventId)`, and orders by contiguous `sessionSequence` ([§4](packages/narad-spec/narad-v1.md#4-identity-and-ordering), [§10](packages/narad-spec/narad-v1.md#10-replay-history-and-delivery)). The shipped coordinator subscribes, then backfills, so live and replay merge without a hole ([§10.3](packages/narad-spec/narad-v1.md#103-subscribe-before-replay)). Replay from zero is the normal path.

**Replay re-executes a tool.** If a client runs a side effect because it saw `tool.call.started`, a reconnect sends the work twice. Authority is observational. Execution happens only from a targeted `client.tool.execute` with a lease and a one-shot `executionToken` the client must record before acting ([§11.3](packages/narad-spec/narad-v1.md#113-targeted-tool-execution)). Duplicate delivery of an accepted token must not run again.

Silence, a dropped socket, and a missed heartbeat are not terminals ([§6.3](packages/narad-spec/narad-v1.md#63-stop), [§11.2](packages/narad-spec/narad-v1.md#112-heartbeats)).

## When you need it

Use Narad when at least two of these are true:

- a human can approve or stop something irreversible
- the UI can refresh, duplicate, or go away for hours
- a second client exists (phone, Slack, another tab)
- a client-side tool has a real side effect
- you must answer “what actually happened?” from history, not from whoever was connected

If none of that is true, a streaming UI protocol is enough.

## Where it sits

[MCP](https://modelcontextprotocol.io/) is agent to tools. [A2A](https://a2a-protocol.org/) is agent to agent. [AG-UI](https://docs.ag-ui.com/introduction) is a runtime UI stream for drawing a turn. Narad is the ordered journal a UI, including an AG-UI client, can sit on. This repo does not ship an AG-UI adapter.

## Packages

| Package | Role |
|---|---|
| [`@devkrity/narad-spec`](packages/narad-spec) | JSON Schema, conformance traces, prose |
| [`@devkrity/narad`](packages/narad) | Headless reducer, replay, attach, command client |
| [`@devkrity/narad-react`](packages/narad-react) | React provider and `useSyncExternalStore` hooks |

## Getting started

Replay a conformance trace. No host required.

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createNaradClientStore, replayJsonlReducer } from '@devkrity/narad';

const specRoot = dirname(createRequire(import.meta.url).resolve('@devkrity/narad-spec/package.json'));
const lines = readFileSync(join(specRoot, 'conformance/interrupt-pause.jsonl'), 'utf8').split('\n');

const store = createNaradClientStore({ sessionId: 'session-3' });
const result = replayJsonlReducer(store, lines);
const snapshot = store.getSnapshot();
// result.applied === 6
// snapshot.runs.get('run-3')?.state === 'finished'
```

That is the same reducer a UI uses.

Against a host you supply a `NaradTransport` (`attach`, `subscribeLive`, `fetchHistory`, `sendControl`, `dispose`). No server SDK ships in this repo. The shipped SSE helper is `createSseFrameParser`.

```ts
import { createAttachCoordinator, createCommandClient, createNaradClientStore } from '@devkrity/narad';

const store = createNaradClientStore({
  sessionId,
  activeProfiles: ['narad.conversation/v1'],
});
const coordinator = createAttachCoordinator(transport, store, {
  sessionId,
  claimedProfiles: ['narad.conversation/v1'],
});
await coordinator.attach();

const commands = createCommandClient({ baseUrl: '/api/narad/v1', fetch });
await commands.resolveInterrupt({ interruptId, decision: 'approve' });
```

`NaradProvider` in `@devkrity/narad-react` reads an existing store. It does not attach, and it does not create one.

## The protocol in one page

- **Commands in, events out.** User intent is `resolve-interrupt`, `stop-active-root`, or `message`. The host accepts or rejects before mutating durable state. Accepted effects appear as authority events ([§2.2](packages/narad-spec/narad-v1.md#22-command-catalog)). Clients never append.
- **Ordering and identity.** Session, workflow, and run-tree sequences are strictly increasing and contiguous. Dedup key is `(sessionId, eventId)`. Timestamps are informational ([§4](packages/narad-spec/narad-v1.md#4-identity-and-ordering)). Delivery is at least once; reducers apply once.
- **Interrupts and pause.** At most one open blocking interrupt per run. `interrupt.requested` is followed consecutively by pause with the same `waitId`. Resolution is a command. Expiry is `interrupt.resolved` with `decision=expired`, written by the backend ([§6](packages/narad-spec/narad-v1.md#6-run-and-workflow-state-machines), [§7.6](packages/narad-spec/narad-v1.md#76-interruptrequested)–[§7.7](packages/narad-spec/narad-v1.md#77-interruptresolved)).
- **Client execution.** `tool.call.started` with `executor=client` is not permission to run. The bound executor receives `client.tool.execute` with `leaseId` and `executionToken` ([§11](packages/narad-spec/narad-v1.md#11-client-execution-and-heartbeat-control)).
- **Profiles.** Servers advertise `activeProfiles` before sending profile events. Clients ignore unnegotiated profiles and fail closed on unknown types from a claimed profile ([§2.1](packages/narad-spec/narad-v1.md#21-protocol-profiles), [§13](packages/narad-spec/narad-v1.md#13-conformance)).
- **Validation.** Unknown protocol versions are rejected. JSON Schema defines structure; golden traces define lifecycle and replay.

An interrupt from the trace above, as the wire carries it:

```json
{
  "type": "interrupt.requested",
  "protocolVersion": "narad/v1",
  "eventId": "evt-2",
  "timestamp": "2026-08-05T00:00:01Z",
  "sessionId": "session-3",
  "sessionSequence": 2,
  "rootRunId": "run-3",
  "runId": "run-3",
  "sequence": 2,
  "interruptId": "interrupt-1",
  "waitId": "wait-1",
  "kind": "approval",
  "actions": ["approve", "deny"]
}
```

## Conformance

[`packages/narad-spec/schema`](packages/narad-spec/schema) and [`packages/narad-spec/conformance`](packages/narad-spec/conformance) are the contract. The TypeScript client is asserted against those traces.

```sh
pnpm install
pnpm verify
```

`pnpm verify` is the release gate: spec validation, build, typecheck, tests, public `.d.ts` smoke, and dist import smoke. Do not commit `dist/`; `prepare` builds it on install.

## Consume from this repo

Packages are unpublished. Pin a git tag and a `path:` into the monorepo. `prepare` builds `dist/` on install. Private clones need a token with Contents:read on `shukla-amit/narad`. GitHub Actions' default `GITHUB_TOKEN` cannot clone a second private repo.

pnpm 11.5.2 will refuse the git `prepare` unless the consumer allowlists the packages (proven: `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`). Put this in the consumer `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@devkrity/narad': true
  '@devkrity/narad-react': true
  esbuild: true
```

Write the full specifier in `package.json`. `pnpm add` may drop `#tag&path:` from that file; the lockfile still stores the resolved commit and path.

```json
{
  "dependencies": {
    "@devkrity/narad": "git+https://github.com/shukla-amit/narad.git#v0.1.0-alpha.1&path:packages/narad",
    "@devkrity/narad-react": "git+https://github.com/shukla-amit/narad.git#v0.1.0-alpha.1&path:packages/narad-react",
    "@devkrity/narad-spec": "git+https://github.com/shukla-amit/narad.git#v0.1.0-alpha.1&path:packages/narad-spec"
  }
}
```

After `@devkrity` is reserved on npm, the same versions publish as `@devkrity/narad`, `@devkrity/narad-react`, and `@devkrity/narad-spec`.

## Status

Packages are `0.1.0-alpha.1`. This repo does not ship a server SDK, a Python SDK, or an AG-UI adapter. The shipped command client covers `resolve-interrupt`; `message` and `stop-active-root` are host-defined bindings ([§2.2](packages/narad-spec/narad-v1.md#22-command-catalog)). Spec prose, schemas, and traces live in `@devkrity/narad-spec`; the TypeScript client and React bindings consume them.

## Host

Narad was extracted from Kautuka, a local-first agent appliance that hosts it. Kautuka is a host, not a Narad server package.

## License

MIT. See [LICENSE](./LICENSE).
