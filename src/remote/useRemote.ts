/**
 * React binding: exposes the ConversationStore snapshot to screens via
 * useSyncExternalStore, and kicks off the synthetic loop's initial load.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { demoRuntime } from './demo';
import type { StoreState } from './store';

let loadStarted = false;

export function useRemote(): { state: StoreState } {
  const runtime = demoRuntime();
  useEffect(() => {
    if (loadStarted) return;
    loadStarted = true;
    void runtime.store.load();
  }, [runtime]);
  const state = useSyncExternalStore(
    listener => runtime.store.subscribe(listener),
    () => runtime.store.snapshot(),
  );
  return { state };
}

export function remoteRuntime() { return demoRuntime(); }
