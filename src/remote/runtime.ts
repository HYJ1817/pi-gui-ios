/**
 * Assemble the conversation store and stream lifecycle from explicit ports.
 * This module owns no fixtures, pairing, native lookup or connection policy.
 * Construction is cold; the composition root decides when to open the stream.
 */
import type { TypedRemoteClient } from './client';
import { EventStreamClient, type EventClientOptions, type StreamTransport } from './events';
import { ConversationStore } from './store';
import type { CryptoProvider, DeviceCredentials } from './types';

export interface RemoteRuntime {
  client: TypedRemoteClient;
  events: EventStreamClient;
  store: ConversationStore;
  credentials: DeviceCredentials;
  openStream: () => void;
  reopenStream: () => void;
  recoverStream: () => Promise<void>;
  closeStream: () => void;
}

export function createRemoteRuntime(options: {
  client: TypedRemoteClient;
  crypto: CryptoProvider;
  stream: StreamTransport;
  /** Required policy from the composition root; no demo authorization default. */
  authorizeResource: EventClientOptions['authorizeResource'];
}): RemoteRuntime {
  const { client, crypto, stream, authorizeResource } = options;
  const credentials = client.credentials();
  const events = new EventStreamClient({
    credentials, crypto, authorizeResource,
    onReset: () => { /* store.apply handles the reset and baseline rebuild */ },
    onEvent: applied => store.apply(applied),
    onStreamError: () => store.markStreamError(),
    onConnected: () => store.markStreamLive(),
  });
  const store = new ConversationStore(client, events);

  return {
    client, events, store, credentials,
    openStream: () => {
      events.open(stream, client.buildEventsRequest(events.latestCursor()), events.latestCursor());
    },
    reopenStream: () => {
      events.close();
      events.open(stream, client.buildEventsRequest(events.latestCursor()), events.latestCursor());
    },
    /** Reload baselines, then resume at their atomic watermark so frames
     * emitted during recovery are replayed rather than lost at the live head. */
    recoverStream: async () => {
      events.close();
      store.markStreamRecovering();
      await store.load();
      if (store.snapshot().lastError) { store.markStreamError(); return; }
      const watermark = store.latestWatermark();
      const cursor = watermark?.cursor;
      events.open(stream, client.buildEventsRequest(cursor), cursor, watermark);
    },
    closeStream: () => events.close(),
  };
}
