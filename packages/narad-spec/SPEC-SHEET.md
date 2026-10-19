# Narad product spec sheet

**The journal protocol for agent work that keeps moving.**

Narad gives agent hosts a durable, ordered way to describe work across runs, nested agents, workflows, human decisions, tools, and conversation. Its TypeScript client turns that stream into replayable session state for chat, approvals, workflow views, and custom applications.

Narad is designed for work that can pause, branch, delegate, run on another client, or outlive the connection that started it.

## At a glance

| | |
|---|---|
| **Protocol** | `narad/v1` |
| **Approach** | Journal-first, transport-neutral, event-reduced |
| **Packages** | Protocol spec, framework-neutral TypeScript client, React bindings |
| **Current package version** | `0.1.0-alpha.3` |
| **Specification status** | Release Candidate 1, as recorded in the normative protocol document |
| **License** | MIT |

## What you can build

### Nested agents and runs

Represent work as a hierarchy: a workflow starts a run, a run invokes a tool or delegates to another agent, and the child run remains connected to its parent and root execution. Clients can follow run state, tool calls, interrupts, usage, and outcomes across that hierarchy.

Narad standardizes the run and tool lifecycle. Agent identity, dispatch policy, and the host’s agent catalog remain host concerns.

### Human-supervised continuation

Make approval, review, or input a durable checkpoint in the same execution history. An interrupt identifies the wait cycle and allowed actions; a matching pause follows; a valid resolution closes that interrupt; and the host records the subsequent resume or terminal outcome.

Interrupts can be run-scoped or workflow-scoped. Packed HITL requests can retain a decision for each member and an aggregate outcome. Clients can show who or what is waiting, what decision is requested, and what happened after the decision.

For tool approvals, the host can associate the approval with its tool call. The journal then records the decision alongside that relationship, so a replay can show exactly which action was approved and what the run did next.

### Workflows with explainable branches

Record workflow lifecycle, step progress, run ownership, and selected transitions. A branch event can retain its source and target plus optional case index, condition pointer, and operator. Replaying the journal reconstructs which path was taken and where the work stands.

### Reconnect without losing the story

Use stable event identity and explicit session, workflow, and run-tree sequences to rebuild the same state from history. The client coordinator subscribes to live updates, backfills history, merges buffered delivery, and catches up when it finds a sequence gap.

Hydrated transcript and graph views are tied to authority cursors. They help clients recover efficiently while leaving lifecycle truth in the journal.

### Client-side tools with an execution boundary

Keep UI or device-local actions in the client when the host assigns them there. The host targets a bound executor with a lease and execution token. A journal event describing a tool call is observational; it never grants permission to execute. The executor also exposes cancellation through an `AbortSignal` to registered tool handlers.

### Rich session and application state

The client reducer supports streamed conversation and reasoning, transcript hydration, display redaction, attachments, artifacts, run progress, scoped state, UI state, custom views, graph projections, and workspace session updates. React consumers can subscribe to the full snapshot or a selected value.

## Capabilities by package

| Capability | Protocol contract | TypeScript client | React bindings |
|---|---|---|---|
| Run lifecycle, nested-run references, tools, interrupts | Core events and lifecycle rules | Validation, reducer, replay, executor | Read via snapshot/selectors |
| Workflows, steps, branch transitions | Workflow profile | Workflow snapshots and transition state | Read via snapshot/selectors |
| Conversation, reasoning, redaction, transcript hydrate | Conversation profile | Stream reduction and snapshot merge | Read via snapshot/selectors |
| Attachments and artifacts | Optional profiles | Lifecycle snapshots | Read via snapshot/selectors |
| Progress, scoped state, UI state, views | Optional profiles | Reduction, revisions, patching, gap state | Read via snapshot/selectors |
| Run graph hydrate | Graph profile | Cursor-aware snapshot/delta reduction | Read via snapshot/selectors |
| Workspace session watch | Workspace profile | Workspace session projection | Read via snapshot/selectors |
| Attach, history, live recovery | Transport contract | Coordinator and SSE frame parser | Host owns transport lifecycle |

The protocol also defines extensions and trace/debug profiles. Profile negotiation lets a host and client select the event families they understand before profile events are delivered.

## How the model fits together

```text
Human intent ── command ──▶ Host / agent runtime
                                  │ accepts or rejects
                                  ▼
                         Authority event journal
                           │        │        │
                        replay   live     hydrate
                           └────┬───┴────────┘
                                ▼
                     Narad client store / reducer
                      ├─ workflow and run tree
                      ├─ approvals and tool state
                      ├─ conversation and progress
                      └─ app views and workspace state
```

Four wire-data classes have distinct jobs:

- **Authority events** record backend-issued facts and determine lifecycle state.
- **Watch events** signal that a scope changed and clients should catch up.
- **Hydrate records** carry derived projections anchored to authority cursors.
- **Control messages** handle attach, heartbeat, and targeted client execution outside the journal.

This separation makes replay predictable: a client can observe an event many times without treating observation as execution or user intent.

## What this repository includes

- `@devkrity/narad-spec`: JSON Schema, conformance traces, and normative protocol prose.
- `@devkrity/narad`: TypeScript wire validation, lifecycle reducers, replay, external store, SSE parsing, attach/recovery coordinator, command client, and client executor.
- `@devkrity/narad-react`: provider and `useSyncExternalStore`-based hooks, including selector equality.

Install the client libraries from npm:

```sh
npm i @devkrity/narad @devkrity/narad-react
```

Add `@devkrity/narad-spec` when you need the published schemas and conformance traces:

```sh
npm i @devkrity/narad-spec
```

This repository does not include a server SDK. A host supplies durable storage and journal writes, authorization, transport endpoints, command processing, workflow scheduling, agent dispatch, and its product UI. Narad defines the event and client model those pieces can share.

## Start here

- For the developer overview and examples, read the [repository README](../../README.md).
- For the complete normative contract, read [`narad-v1.md`](./narad-v1.md).
- For package exports and conformance material, see the [`@devkrity/narad-spec` package](./README.md).

The wire name is `narad/v1`. The current normative document is marked Release Candidate 1; package versions are `0.1.0-alpha.3`.
