# Narad

Replayable agent interaction protocol. Clients reduce an authority journal. They never append to it. User intent enters as commands (`resolve-interrupt`, `stop-active-root`, `message`); accepted effects appear as domain events.

Wire id: `narad/v1`. Speak: *NAH-rud*. Spell **Narad**, never Narada.

| Package | Role |
|---|---|
| [`@devkrity/narad-spec`](packages/narad-spec) | JSON Schema, conformance traces, prose |
| [`@devkrity/narad`](packages/narad) | Headless reducer, replay, attach, command client |
| [`@devkrity/narad-react`](packages/narad-react) | React provider and `useSyncExternalStore` hooks |

Requires Node 22+ and pnpm 11.5.2. License: [MIT](./LICENSE).

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
