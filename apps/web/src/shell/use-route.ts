import { useSyncExternalStore } from 'react';
import { type Route, routeOf } from './route';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
};

const currentHash = (): string => window.location.hash;

export const useRoute = (): Route => routeOf(useSyncExternalStore(subscribe, currentHash));
