# Narad

**Make agent work recoverable, inspectable, and safe to supervise.**

Narad is a journal-first protocol and TypeScript client toolkit for durable agent sessions. It gives a host one ordered account of what happened across workflows, nested runs, tool calls, human decisions, conversation, and generated outputs. Clients can rebuild their view from that account after a refresh or disconnect, while the host remains in control of execution and durable writes.

For tool approvals, Narad keeps the decision tied to the tool call it governs and records the outcome in the journal, so replay shows what was approved and how the run continued.

Wire protocol: `narad/v1` · Say *NAH-rud* · Spell **Narad**, never Narada.

Packages: `0.1.0-alpha.3` · Development: Node 22+ and pnpm 11.5.2 · MIT

[Read the product spec sheet](packages/narad-spec/SPEC-SHEET.md) · [Read the normative protocol](packages/narad-spec/narad-v1.md)

## Agent work that survives real life

Agent work rarely happens in one uninterrupted stream. A workflow may delegate to another agent, pause while a person reviews a risky action, continue through a branch, or wait while a client-side tool is unavailable. The browser may close in the middle. Narad models these as durable lifecycle facts, so a client can reconnect and understand the same work rather than inventing a new state from whatever frames it happened to see.

```text
Workflow: prepare a release
  ├─ Run: inspect changes
  │    └─ Tool: delegate to security agent
  │         └─ Nested run: review dependencies
  │              └─ Approval requested → paused
  ├─ Human decision: approve
  ├─ Run resumes and completes
  └─ Workflow records the selected next step

Authority journal → replayable state → React UI, workspace view, or custom client
```

Narad keeps **what happened**, **what someone asked to happen**, and **what may execute on a client** as distinct things:

- The backend appends authority events. Clients reduce and replay them; they never append facts to the journal.
- Commands carry intent, such as resolving an interrupt. The host accepts or rejects that intent, and accepted outcomes appear in the journal.
- Side-effecting client tools execute only from a targeted control message with a lease and execution token. Seeing a historical `tool.call.started` event never runs the tool.

## Capabilities

| Capability | What it lets a host build |
|---|---|
| **Nested agent runs** | Connect child runs to their parent run and invoking tool call; follow delegated work under the same root execution. |
| **Human decision points** | Pause a run or workflow for approval, input, or review; record the accepted decision and resume the matching wait cycle. |
| **Workflow orchestration** | Record steps, run ownership, lifecycle, and selected branch transitions with their decision metadata. |
| **Reconnect and replay** | Merge live delivery with history, detect sequence gaps, recover from the last cursor, and rebuild state deterministically. |
| **Replay-safe client tools** | Route work to a bound client executor using leases and one-shot execution tokens instead of treating journal replay as permission to act. |
| **Conversation and activity** | Reduce streamed messages and reasoning, progress, attachments, artifacts, and display redactions alongside run state. |
| **Stateful experiences** | Synchronize scoped application state and UI views with revisioned snapshots and deltas. |
| **Run and workspace views** | Build activity inspectors, workflow views, and workspace session lists from typed state and revision notifications. |

Human decisions are first-class lifecycle facts. One run may have one open blocking interrupt at a time; the resolution must match its open interrupt and advertised actions. Packed approval requests can also retain per-member decisions and an aggregate outcome.

For the protocol-defined feature set, package boundaries, and implementation map, see the [spec sheet](packages/narad-spec/SPEC-SHEET.md).

## Packages

| Package | Provides |
|---|---|
| [`@devkrity/narad-spec`](packages/narad-spec) | `narad/v1` JSON Schemas, conformance traces, and normative protocol specification. |
| [`@devkrity/narad`](packages/narad) | Framework-neutral validation, reducers, replay, SSE parsing, attach/recovery coordination, commands, and client tool execution. |
| [`@devkrity/narad-react`](packages/narad-react) | React provider and selector hooks over an existing Narad client store. |

The packages are currently `0.1.0-alpha.3`. This repository provides the protocol contract and client-side libraries. A host supplies its durable journal and storage, authorization, transport endpoints, command handling, scheduler, and agent/tool policy. Narad is transport-neutral; SSE is one supported client transport helper, not a required server architecture.

## Get started

### Replay a trace

Replay a published conformance trace with the same reducer a UI uses. No server is needed for this example.

```ts
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createNaradClientStore, replayJsonlReducer } from '@devkrity/narad';

const specRoot = dirname(createRequire(import.meta.url).resolve('@devkrity/narad-spec/package.json'));
const lines = readFileSync(join(specRoot, 'conformance/interrupt-pause.jsonl'), 'utf8').split('\n');

const store = createNaradClientStore({ sessionId: 'session-3' });
const result = replayJsonlReducer(store, lines);
const snapshot = store.getSnapshot();

assert.equal(result.applied, 6);
assert.equal(snapshot.runs.get('run-3')?.state, 'finished');
console.log('Narad replay example passed.');
```

### Attach to a host

Implement `NaradTransport` for your host’s attach, live subscription, history, and control endpoints. The coordinator handles profile negotiation, history backfill, buffered live events, and catch-up after a sequence gap.

```ts
import {
  createAttachCoordinator,
  createCommandClient,
  createNaradClientStore,
} from '@devkrity/narad';

const store = createNaradClientStore({
  sessionId,
  activeProfiles: ['narad.workflow/v1', 'narad.conversation/v1'],
});

const coordinator = createAttachCoordinator(transport, store, {
  sessionId,
  claimedProfiles: ['narad.workflow/v1', 'narad.conversation/v1'],
});
await coordinator.attach();

const commands = createCommandClient({ baseUrl: '/api/narad/v1', fetch });
await commands.resolveInterrupt({ interruptId, decision: 'approve' });
```

The `@devkrity/narad-react` `NaradProvider` accepts an existing store. It does not create a store or attach a session; transport and session ownership stay with the host application.

## Protocol model

Narad uses four kinds of wire data:

- **Authority events** are ordered, immutable facts from the host. They define lifecycle and conversation state.
- **Watch events** announce that a scope changed and give the client a reason to catch up from history.
- **Hydrate records** carry derived views, such as transcript or graph snapshots, anchored to an authority cursor.
- **Control messages** handle attach, heartbeat, and targeted client-tool execution outside the journal.

Session, workflow, and run-tree sequences keep ordering explicit. Stable event identities support duplicate delivery; reducers reject conflicting reuse. Timestamps provide context but do not decide authority order. Workflow choice events record the branch selected, while graph hydrate data remains a rebuildable projection and cannot override lifecycle facts.

Profiles let hosts and clients agree on optional capabilities before profile events are sent. A client ignores profiles it did not negotiate and validates the profiles it claims to understand.

The full contract—including lifecycle requirements, event fields, security boundaries, and conformance rules—is in [`narad-v1.md`](packages/narad-spec/narad-v1.md).

## Install

```sh
npm i @devkrity/narad @devkrity/narad-react
```

Add `@devkrity/narad-spec` if your application needs the published schemas and conformance traces:

```sh
npm i @devkrity/narad-spec
```

## Validate this repository

```sh
pnpm install
pnpm verify
```

`pnpm verify` validates schemas and traces, builds and typechecks the packages, runs tests, then checks public declarations and built-package imports.

## Learn more

- [Narad product spec sheet](packages/narad-spec/SPEC-SHEET.md)
- [Normative Narad v1 protocol](packages/narad-spec/narad-v1.md)
- [Core client package](packages/narad/README.md)
- [React bindings](packages/narad-react/README.md)
- [Conformance schemas and traces](packages/narad-spec)

Narad was extracted from Kautuka, which hosts the protocol in a local-first agent appliance. Kautuka is one host for Narad; its runtime and server implementation are maintained separately.
