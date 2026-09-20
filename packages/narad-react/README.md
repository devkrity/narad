# @devkrity/narad-react

Minimal React bindings for [`@devkrity/narad`](../narad/README.md).

This package does **not** create stores, attach sessions, or run transport. Pass an already-created `NaradClientStore` to `NaradProvider` and read state with `useSyncExternalStore`-based hooks.

## Install

```bash
pnpm add @devkrity/narad-react @devkrity/narad react
```

## Usage

```tsx
import { createNaradClientStore } from '@devkrity/narad';
import { NaradProvider, useNaradSnapshot, useNaradSelector } from '@devkrity/narad-react';

const store = createNaradClientStore({ sessionId: 'sess-1', activeProfiles: ['narad.conversation/v1'] });

function SessionId() {
  const sessionId = useNaradSelector((snapshot) => snapshot.sessionId);
  return <span>{sessionId}</span>;
}

export function App() {
  return (
    <NaradProvider store={store}>
      <SessionId />
    </NaradProvider>
  );
}
```

## API

- `NaradProvider` — supplies an existing `NaradClientStore` via context (no dispose on unmount).
- `useNaradClientStore()` — returns the store; throws outside `NaradProvider`.
- `useNaradSnapshot()` — full session snapshot via `useSyncExternalStore`.
- `useNaradSelector(selector, isEqual?)` — focused slice with stable selected value when equality holds.
