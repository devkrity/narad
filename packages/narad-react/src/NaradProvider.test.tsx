import { render, act } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NARAD_PROFILE_IDS, createNaradClientStore, type NaradClientStore, type NaradSessionSnapshot } from '@devkrity/narad';
import { NaradProvider, useNaradClientStore, useNaradSelector, useNaradSnapshot } from './NaradProvider';

const ALL_PROFILES = Object.values(NARAD_PROFILE_IDS);

const selectSessionSequenceCount = (snapshot: NaradSessionSnapshot) => ({
  count: snapshot.lastSessionSequence,
});

const sessionSequenceCountsEqual = (
  previous: { count: number },
  next: { count: number },
) => previous.count === next.count;

function createTestStore(sessionId = 'sess-1'): NaradClientStore {
  return createNaradClientStore({ sessionId, activeProfiles: ALL_PROFILES });
}

function SnapshotProbe({ onSnapshot }: { onSnapshot: (snapshot: NaradSessionSnapshot) => void }) {
  const snapshot = useNaradSnapshot();
  onSnapshot(snapshot);
  return <span data-testid="session-id">{snapshot.sessionId}</span>;
}

function SelectorProbe({
  onValue,
  onRender,
}: {
  onValue: (value: string) => void;
  onRender?: () => void;
}) {
  onRender?.();
  const sessionId = useNaradSelector((snapshot) => snapshot.sessionId);
  onValue(sessionId);
  return <span>{sessionId}</span>;
}

function StoreProbe({ onStore }: { onStore: (store: NaradClientStore) => void }) {
  onStore(useNaradClientStore());
  return null;
}

describe('NaradProvider', () => {
  it('wires store snapshot to useNaradSnapshot', () => {
    const store = createTestStore('wired-session');
    let latest: NaradSessionSnapshot | null = null;

    const view = render(
      <NaradProvider store={store}>
        <SnapshotProbe onSnapshot={(snapshot) => { latest = snapshot; }} />
      </NaradProvider>,
    );

    expect(view.getByTestId('session-id').textContent).toBe('wired-session');
    expect(latest).not.toBeNull();
    expect(latest!.sessionId).toBe('wired-session');
  });

  it('throws when hooks are used outside NaradProvider', () => {
    const consoleError = console.error;
    console.error = () => undefined;

    expect(() => render(<StoreProbe onStore={() => undefined} />)).toThrow(
      'useNaradClientStore must be used within NaradProvider.',
    );

    console.error = consoleError;
  });

  it('returns the same store instance from useNaradClientStore', () => {
    const store = createTestStore();
    let resolved: NaradClientStore | null = null;

    render(
      <NaradProvider store={store}>
        <StoreProbe onStore={(value) => { resolved = value; }} />
      </NaradProvider>,
    );

    expect(resolved).toBe(store);
  });
});

describe('useNaradSelector', () => {
  it('updates when the selected slice changes', () => {
    const store = createTestStore('alpha');
    const values: string[] = [];

    render(
      <NaradProvider store={store}>
        <SelectorProbe onValue={(value) => values.push(value)} />
      </NaradProvider>,
    );

    act(() => {
      store.clearSessionGap();
    });

    expect(values[values.length - 1]).toBe('alpha');
  });

  it('does not rerender when an unrelated snapshot field changes but selection is equal', () => {
    const store = createTestStore('stable-session');
    let renderCount = 0;
    const seenValues: string[] = [];

    render(
      <NaradProvider store={store}>
        <SelectorProbe
          onRender={() => { renderCount += 1; }}
          onValue={(value) => { seenValues.push(value); }}
        />
      </NaradProvider>,
    );

    const rendersAfterMount = renderCount;

    act(() => {
      store.clearSessionGap();
    });

    expect(renderCount).toBe(rendersAfterMount);
    expect(seenValues.every((value) => value === 'stable-session')).toBe(true);
  });

  it('recomputes when the selector changes against an unchanged store snapshot', () => {
    const store = createTestStore('stable-session');
    const values: string[] = [];

    function PropSelectorProbe({ field }: { field: 'sessionId' | 'lastSessionSequence' }) {
      const value = useNaradSelector((snapshot) =>
        field === 'sessionId' ? snapshot.sessionId : String(snapshot.lastSessionSequence),
      );
      values.push(value);
      return <span>{value}</span>;
    }

    const view = render(
      <NaradProvider store={store}>
        <PropSelectorProbe field="sessionId" />
      </NaradProvider>,
    );

    expect(values[values.length - 1]).toBe('stable-session');

    view.rerender(
      <NaradProvider store={store}>
        <PropSelectorProbe field="lastSessionSequence" />
      </NaradProvider>,
    );

    expect(values[values.length - 1]).toBe('0');
  });

  it('respects custom equality to preserve selected value identity', () => {
    const store = createTestStore('eq-session');
    const values: Array<{ count: number }> = [];
    let renderCount = 0;

    function CountProbe() {
      renderCount += 1;
      const selection = useNaradSelector(selectSessionSequenceCount, sessionSequenceCountsEqual);
      values.push(selection);
      return null;
    }

    render(
      <NaradProvider store={store}>
        <CountProbe />
      </NaradProvider>,
    );

    const rendersAfterMount = renderCount;
    const lastValue = values[values.length - 1];

    act(() => {
      store.clearSessionGap();
    });

    expect(renderCount).toBe(rendersAfterMount);
    expect(values[values.length - 1]).toBe(lastValue);
  });
});

describe('SSR getServerSnapshot', () => {
  it('renders on the server without browser globals', () => {
    const store = createTestStore('server-session');
    const html = renderToString(
      <NaradProvider store={store}>
        <SnapshotProbe onSnapshot={() => undefined} />
      </NaradProvider>,
    );

    expect(html).toContain('server-session');
  });
});

describe('StrictMode subscription cleanup', () => {
  it('does not leak listeners after unmount', () => {
    const listeners = new Set<() => void>();
    let snapshot: NaradSessionSnapshot = createTestStore('strict').getSnapshot();

    const store: NaradClientStore = {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => snapshot,
      apply: () => ({ applied: false, duplicate: true, gap: false, resyncRequired: false }),
      clearSessionGap: () => undefined,
      clearResyncRequired: () => undefined,
      setActiveProfiles: () => undefined,
    };

    const view = render(
      <StrictMode>
        <NaradProvider store={store}>
          <SnapshotProbe
            onSnapshot={(next) => {
              snapshot = next;
            }}
          />
        </NaradProvider>
      </StrictMode>,
    );

    expect(listeners.size).toBeGreaterThan(0);

    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
