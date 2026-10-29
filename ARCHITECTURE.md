# Narad Protocol — architecture and contributor overview

## Repository map

- `packages/narad-spec/` owns the normative `narad/v1` specification, JSON Schemas, profiles, and conformance traces.
- `packages/narad/` implements framework-neutral validation, reducers, replay, SSE parsing, attach/recovery coordination, commands, and targeted client execution.
- `packages/narad-react/` binds an existing Narad store to React; it does not own transport or session authority.
- `scripts/` validates schemas and protocol requirements; `smoke/` checks built package exports.
- `examples/` contains a minimal host and client that exchange validated authority events over SSE.

## Data flow

A host owns the journal and appends ordered authority events. A transport delivers live SSE events and retrieves missed history. The client validates records, feeds them to the reducer/store, and can reconstruct state through replay or catch-up. Commands carry client intent back to the host; they never write authority facts directly. The host remains responsible for authorization and durable writes. See the [normative protocol](packages/narad-spec/narad-v1.md) for wire-level requirements.

The attach coordinator negotiates profiles, coordinates history backfill with buffered live delivery, and recovers after gaps. Client tools have a separate targeted control path with leases and one-shot execution tokens; replayed events do not execute side effects. React renders a store supplied by the host application.

## Adding protocol coverage

Add or update a conformance trace under `packages/narad-spec/conformance/` and schema coverage as appropriate. Run `pnpm spec:check` and the full `pnpm verify` before proposing the change. Keep protocol changes consistent with the normative specification and package APIs.

## Release process

The GitHub Actions workflow `.github/workflows/publish-npm.yml` publishes packages after an approved versioned release workflow. Update affected package versions and changelog entries together; verify the release from built package artifacts. Do not publish packages from local development branches.
