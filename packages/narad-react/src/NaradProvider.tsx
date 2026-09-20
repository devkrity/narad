import React from 'react';
import type { NaradClientStore } from '@devkrity/narad';
import { NaradStoreContext } from './storeContext.js';

export type NaradProviderProps = Readonly<{
  store: NaradClientStore;
  children: React.ReactNode;
}>;

export function NaradProvider({ store, children }: NaradProviderProps): React.ReactElement {
  return <NaradStoreContext.Provider value={store}>{children}</NaradStoreContext.Provider>;
}

export { useNaradClientStore } from './storeContext.js';
export { useNaradSnapshot, useNaradSelector } from './hooks.js';
export type { NaradSelectorEqualityFn } from './hooks.js';
