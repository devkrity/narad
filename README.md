# Narad Protocol

[![npm](https://img.shields.io/npm/v/@devkrity/narad)](https://www.npmjs.com/package/@devkrity/narad) [![CI](https://github.com/devkrity/narad/actions/workflows/ci.yml/badge.svg)](https://github.com/devkrity/narad/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Narad Protocol is an open, MIT-licensed protocol for how an AI-agent host talks to all its apps (web, terminal, chat). It covers agents that start other agents, multi-step workflows, pauses for a person to approve something, and tools that run on the user's side using single-use permission tokens. Apps send requests and check what the host tells them against strict rules, so every app stays in step with the host. It ships as a spec plus small TypeScript and React libraries (`@devkrity/narad*`). [Kautuka](https://github.com/devkrity/kautuka) is the reference app that uses it.

**Make agent work recoverable, inspectable, and safe to supervise.**

Narad defines how a host and its apps exchange agent, workflow, approval, and client-tool state. TypeScript and React libraries help apps validate host updates and stay aligned across refreshes and reconnects, while the host remains in control of execution and durable writes.

For tool approvals, Narad keeps the decision tied to the tool call it governs and records the outcome in the journal, so replay shows what was approved and how the run continued.

Wire protocol: `narad/v1` · Say *NAH-rud* · Spell **Narad**, never Narada.

Version: `0.1.0` · Development: Node 22+ and pnpm 11.5.2 · MIT

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

Host updates → consistent client state → React UI, workspace view, or custom client
```

Narad keeps **what happened**, **what someone asked to happen**, and **what may execute on a client** as distinct things:

- The host is authoritative for agent, workflow, and approval state. Apps validate updates and display that state; they cannot write host facts directly.
- Commands carry intent, such as resolving an interrupt. The host accepts or rejects the request and sends the resulting state to its apps.
- Side-effecting client tools execute only from a targeted control message with a lease and execution token. A previously received update never grants permission to execute a tool.

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

## Why hosts use Narad

**A refresh can lose the current view.** A stream-only UI knows only the updates it happened to receive. Narad lets an app reconnect, request missed host state, and catch up after sequence gaps.

**A reconnect must not repeat side effects.** Previously received tool updates do not execute a tool. Client-side execution requires a targeted control message with a lease and one-shot execution token, keeping permission separate from ordinary state updates.

## Where Narad fits

[MCP](https://modelcontextprotocol.io/) connects agents with tools; [A2A](https://a2a-protocol.org/) supports agent-to-agent communication; [AG-UI](https://docs.ag-ui.com/introduction) streams agent activity to user interfaces. Narad defines how a host shares agent, workflow, approval, and client-tool state with its apps, so different clients can follow the same work and send requests through the same host authority.

## When Narad is useful

Consider Narad when at least two of these are true:

- A person may approve, reject, or stop an action with real consequences.
- The UI can refresh, disconnect, or be opened from another device.
- A run delegates work to nested agents or spans multiple workflow steps.
- Client-side tools can cause side effects.
- You need to inspect, replay, or recover a run after its original stream is gone.

## Packages

| Package | Provides |
|---|---|
| [`@devkrity/narad-spec`](packages/narad-spec) | `narad/v1` JSON Schemas, conformance traces, and normative protocol specification. |
| [`@devkrity/narad`](packages/narad) | Framework-neutral validation, reducers, replay, SSE parsing, attach/recovery coordination, commands, and client tool execution. |
| [`@devkrity/narad-react`](packages/narad-react) | React provider and selector hooks over an existing Narad client store. |

The package manifests are versioned `0.1.0`. This repository provides the protocol contract and client-side libraries. A host supplies durable state and storage, authorization, transport endpoints, command handling, scheduling, and agent/tool policy. Narad is transport-neutral; SSE is one supported client transport helper, not a required server architecture.

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

Kautuka is the reference host application: [devkrity/kautuka](https://github.com/devkrity/kautuka).

## Learn more

- [Contributor architecture overview](ARCHITECTURE.md)
- [Runnable host and client example](examples/README.md)
- [Narad product spec sheet](packages/narad-spec/SPEC-SHEET.md)
- [Normative Narad v1 protocol](packages/narad-spec/narad-v1.md)
- [Core client package](packages/narad/README.md)
- [React bindings](packages/narad-react/README.md)
- [Conformance schemas and traces](packages/narad-spec)
- [Contributing](CONTRIBUTING.md) — see contribution guidance and sign commits with `git commit -s`.
- [Security policy](SECURITY.md)
