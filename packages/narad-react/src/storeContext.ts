import { createContext, useContext } from 'react';
import type { NaradClientStore } from '@devkrity/narad';

export const NaradStoreContext = createContext<NaradClientStore | null>(null);

export function useNaradClientStore(): NaradClientStore {
  const store = useContext(NaradStoreContext);
  if (store === null) {
    throw new Error('useNaradClientStore must be used within NaradProvider.');
  }
  return store;
}
