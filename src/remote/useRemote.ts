/**
 * React binding: exposes the ConversationStore snapshot to screens via
 * useSyncExternalStore, and kicks off the synthetic loop's initial load.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { demoRuntime, type DemoRuntime } from './demo';
import type { StoreState } from './store';

let loadStarted = false;

export function useRemote(): { state: StoreState } {
  const runtime = remoteRuntime();
  useEffect(() => {
    if (loadStarted) return;
    loadStarted = true;
    // Retry the bootstrap after a failed load — one-shot would leave the UI
    // permanently empty on a transient transport failure.
    void runtime.store.load().catch(() => { loadStarted = false; });
  }, [runtime]);
  const state = useSyncExternalStore(
    listener => runtime.store.subscribe(listener),
    () => runtime.store.snapshot(),
  );
  return { state };
}

/** App composition root: deliberately synthetic. Native transport/profile
 * activation is separate and is never selected by this binding. */
export function remoteRuntime(): DemoRuntime { return demoRuntime(); }
