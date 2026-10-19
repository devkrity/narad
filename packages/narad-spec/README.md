# @devkrity/narad-spec

The canonical contract for the `narad/v1` journal protocol: JSON Schema, conformance traces, and normative protocol prose. This package has no runtime code.

- Start with the [Narad product spec sheet](./SPEC-SHEET.md) for the capability overview and package map.
- Read the [normative protocol](./narad-v1.md) for required event shapes, ordering, lifecycle rules, and conformance.
- See the [repository README](../../README.md) for TypeScript client examples and installation instructions.

The TypeScript client (`@devkrity/narad`) and React bindings (`@devkrity/narad-react`) consume this contract and its conformance traces. Hosts own durable journal writes, authorization, transport, and execution policy.
