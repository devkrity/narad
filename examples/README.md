# Minimal Narad host and client

This runnable example shows the host-authoritative pattern: a tiny Node HTTP server sends ordered authority events as SSE, and a client parses and validates each event with `@devkrity/narad`.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @devkrity/narad build
node examples/host.mjs
```

In another terminal:

```sh
node examples/client.mjs
```

The client prints each validated event and exits after the workflow completes. This example is intentionally small; it demonstrates parsing and validation, not production storage, authentication, replay endpoints, or authorization. For those contracts see [ARCHITECTURE.md](../ARCHITECTURE.md) and the [protocol specification](../packages/narad-spec/narad-v1.md).
