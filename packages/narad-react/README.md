# @devkrity/narad-react

Minimal React bindings for [`@devkrity/narad`](../narad/README.md).

Build React experiences over durable, replayable Narad sessions with a provider and focused selectors.

```sh
npm i @devkrity/narad @devkrity/narad-react
```

Pass an existing `NaradClientStore` to `NaradProvider`; the host application owns session creation, transport, and journal writes. The hooks expose state reduced from the ordered authority journal, including nested runs, workflows, tool activity, and human decisions.

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
