# Contributing

Narad is licensed under the MIT License. Contributions are welcome through
issues and pull requests.

## Developer Certificate of Origin

Sign off every commit with `git commit -s` to certify the Developer
Certificate of Origin (DCO) 1.1 in [DCO](DCO). If your latest commit is missing
its sign-off, fix it with `git commit --amend -s`. To sign off a series of
commits, run `git rebase --signoff main`.

## Development

Use Node.js 22 or later and pnpm 11.5.2. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm verify
```

`pnpm verify` runs the schema checks, build, README example, type checks, tests,
and public export smoke checks.
