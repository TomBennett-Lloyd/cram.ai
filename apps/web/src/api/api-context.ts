import { createContext, useContext } from 'react';
import type { ApiClient } from './api-client';

export const ApiContext = createContext<ApiClient | null>(null);

/** The client `main.tsx` provides; a component outside the provider is a wiring bug. */
export const useApi = (): ApiClient => {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi: no ApiContext provider above this component');
  return client;
};
