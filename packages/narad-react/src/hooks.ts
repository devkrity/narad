import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { NaradClientStore, NaradSessionSnapshot } from '@devkrity/narad';
import { useNaradClientStore } from './storeContext.js';

export type NaradSelectorEqualityFn<T> = (previous: T, next: T) => boolean;

type SelectorCache<T> = {
  snapshot: NaradSessionSnapshot | null;
  selection: T | undefined;
  cachedSelector: ((snapshot: NaradSessionSnapshot) => T) | null;
  cachedIsEqual: NaradSelectorEqualityFn<T> | null;
};

function readSelection<T>(
  store: NaradClientStore,
  selector: (snapshot: NaradSessionSnapshot) => T,
  isEqual: NaradSelectorEqualityFn<T>,
  cache: SelectorCache<T>,
): T {
  const nextSnapshot = store.getSnapshot();
  const selectorChanged = cache.cachedSelector !== selector;
  const isEqualChanged = cache.cachedIsEqual !== isEqual;

  if (
    !selectorChanged &&
    !isEqualChanged &&
    cache.snapshot !== null &&
    Object.is(cache.snapshot, nextSnapshot)
  ) {
    return cache.selection as T;
  }

  const nextSelection = selector(nextSnapshot);
  if (
    !selectorChanged &&
    !isEqualChanged &&
    cache.selection !== undefined &&
    isEqual(cache.selection, nextSelection)
  ) {
    cache.snapshot = nextSnapshot;
    return cache.selection;
  }

  cache.snapshot = nextSnapshot;
  cache.cachedSelector = selector;
  cache.cachedIsEqual = isEqual;
  cache.selection = nextSelection;
  return nextSelection;
}

export function useNaradSnapshot(): NaradSessionSnapshot {
  const store = useNaradClientStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useNaradSelector<T>(
  selector: (snapshot: NaradSessionSnapshot) => T,
  isEqual: NaradSelectorEqualityFn<T> = Object.is,
): T {
  const store = useNaradClientStore();
  const cacheRef = useRef<SelectorCache<T>>({
    snapshot: null,
    selection: undefined,
    cachedSelector: null,
    cachedIsEqual: null,
  });

  const getSelection = useCallback(
    () => readSelection(store, selector, isEqual, cacheRef.current),
    [store, selector, isEqual],
  );
  const getServerSelection = useCallback(
    () => readSelection(store, selector, isEqual, cacheRef.current),
    [store, selector, isEqual],
  );

  return useSyncExternalStore(store.subscribe, getSelection, getServerSelection);
}
