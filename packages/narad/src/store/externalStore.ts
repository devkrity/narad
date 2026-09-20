import type { NaradExternalStore } from '../types.js';

export function createExternalStore<TSnapshot>(getSnapshot: () => TSnapshot): NaradExternalStore<TSnapshot> {
  const listeners = new Set<() => void>();
  let snapshot = getSnapshot();

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): TSnapshot {
      return snapshot;
    },
    /** @internal */
    publish(next: TSnapshot): void {
      if (Object.is(next, snapshot)) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
  } as NaradExternalStore<TSnapshot> & { publish(next: TSnapshot): void };
}

export function bindExternalStore<TSnapshot>(
  store: NaradExternalStore<TSnapshot> & { publish(next: TSnapshot): void },
  getSnapshot: () => TSnapshot,
): () => void {
  return () => {
    store.publish(getSnapshot());
  };
}
