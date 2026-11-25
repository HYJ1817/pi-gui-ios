/** Native boundary contains no device private-key representation. */
import type { CryptoProvider, DeviceCredentials, Scope, SignedRequest, SignedResponse, Transport } from './types';
import type { StreamTransport } from './events';
import { TypedRemoteClient } from './client';
import { canonicalJson, utf8Bytes } from './wire';
import { ConnectionError, validateBootstrap, validateCredentials, validateTransportRequest, validScopes, type RemoteBootstrap } from './transport-policy';

export interface NativeEvent { subscriptionId: string; frame?: string; code?: string }
export interface NativeRemotePort {
  preparePairing(bootstrapJson: string, deviceName: string, requestedScopesJson: string): string;
  exchangePairing(handle: string): Promise<string>;
  activate(handle: string): string;
  deactivate(handle: string): void;
  forget(handle: string): void;
  sign(handle: string, message: string): string;
  verify(publicKey: string, signature: string, message: string): boolean;
  randomBytes(length: number): string;
  send(handle: string, requestJson: string): Promise<string>;
  subscribe(handle: string, subscriptionId: string, requestJson: string): void;
  closeStream(subscriptionId: string): void;
  acknowledgeFrame(subscriptionId: string): void;
  addListener(event: 'remoteFrame' | 'remoteClosed' | 'remoteOpened', listener: (event: NativeEvent) => void): { remove(): void };
}
function parse(raw: unknown, max = 1_048_576): Record<string, unknown> {
  if (typeof raw !== 'string' || utf8Bytes(raw) > max) throw new ConnectionError('transport_unavailable');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ConnectionError('transport_unavailable'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionError('transport_unavailable');
  return value as Record<string, unknown>;
}
function encode(value: unknown): string {
  const raw = canonicalJson(value);
  if (raw === null) throw new ConnectionError('invalid_request');
  return raw;
}
const HANDLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function handleOf(handle: string): string { if (!HANDLE.test(handle)) throw new ConnectionError('pairing_required'); return handle; }

export interface PairingDraft { handle: string; devicePublicKey: string; expiresAt: string }
export function prepareNativePairing(port: NativeRemotePort, input: RemoteBootstrap, deviceName: string, scopes: Scope[] = ['projects.read', 'sessions.read']): PairingDraft {
  const bootstrap = validateBootstrap(input);
  if (typeof deviceName !== 'string' || deviceName.length < 1 || deviceName.length > 48 || /[\x00-\x1f\x7f]/.test(deviceName) || !validScopes(scopes)) throw new ConnectionError('invalid_request');
  const out = parse(port.preparePairing(encode(bootstrap), deviceName, encode([...scopes].sort())), 4096);
  if (typeof out.handle !== 'string' || typeof out.devicePublicKey !== 'string' || typeof out.expiresAt !== 'string'
    || Object.keys(out).some(k => !['handle', 'devicePublicKey', 'expiresAt'].includes(k))) throw new ConnectionError('pairing_required');
  return { handle: handleOf(out.handle), devicePublicKey: out.devicePublicKey, expiresAt: out.expiresAt };
}
export type PairingOutcome = { ok: true; credentials: DeviceCredentials } | { ok: false; code: 'pairing_rejected' | 'pairing_expired' | 'rate_limited' | 'transport_unavailable'; retryable: boolean };
export async function exchangeNativePairing(port: NativeRemotePort, handle: string): Promise<PairingOutcome> {
  let out: Record<string, unknown>;
  try { out = parse(await port.exchangePairing(handleOf(handle)), 16384); }
  catch { return { ok: false, code: 'transport_unavailable', retryable: false }; }
  if (out.ok === true && Object.keys(out).length === 2) return { ok: true, credentials: validateCredentials(out.credentials) };
  const code = ['pairing_rejected', 'pairing_expired', 'rate_limited'].includes(String(out.code)) ? out.code as 'pairing_rejected' | 'pairing_expired' | 'rate_limited' : 'transport_unavailable';
  return { ok: false, code, retryable: out.retryable === true && code === 'pairing_rejected' };
}

/** Explicit opt-in only. Loading this file or launching the App opens no sockets. */
export function createNativeRemote(port: NativeRemotePort, handle: string, enabled = false) {
  if (enabled !== true) throw new ConnectionError('disabled');
  handleOf(handle);
  let credentials: DeviceCredentials;
  try { credentials = validateCredentials(parse(port.activate(handle), 16384)); }
  catch {
    try { port.deactivate(handle); } catch { /* no raw bridge error reaches callers */ }
    throw new ConnectionError('pairing_required');
  }
  let closed = false;
  const handles = new Set<{ close(): void }>();
  const active = () => { if (closed) throw new ConnectionError('disabled'); };
  const crypto: CryptoProvider = {
    sign: message => { active(); return port.sign(handle, message); },
    verify: (key, signature, message) => { active(); return port.verify(key, signature, message); },
    randomBytes: length => { active(); return port.randomBytes(length); },
  };
  const transport: Transport = {
    async send(request: SignedRequest): Promise<SignedResponse> {
      active(); validateTransportRequest(request, false);
      let out: Record<string, unknown>;
      try { out = parse(await port.send(handle, encode(request)), 6_400_000); }
      catch { throw new ConnectionError('transport_unavailable'); }
      active();
      if (Object.keys(out).length !== 2 || !Number.isInteger(out.status) || (out.status as number) < 100 || (out.status as number) > 599
        || typeof out.body !== 'string' || utf8Bytes(out.body) > 1_048_576) throw new ConnectionError('transport_unavailable');
      return { status: out.status as number, body: out.body };
    },
  };
  const stream: StreamTransport = {
    subscribe(request, onFrame, onClose, onOpen) {
      active(); validateTransportRequest(request, true);
      if (handles.size >= 2) throw new ConnectionError('capacity_exceeded');
      const subscriptionId = port.randomBytes(24);
      if (!/^[A-Za-z0-9_-]{32}$/.test(subscriptionId)) throw new ConnectionError('transport_unavailable');
      let ended = false;
      const listeners: { remove(): void }[] = [];
      const finish = (reason?: string) => {
        if (ended) return; ended = true;
        for (const listener of listeners) listener.remove();
        handles.delete(sub);
        try { port.closeStream(subscriptionId); } catch { /* cancellation never leaks a native exception */ }
        if (reason) onClose(reason);
      };
      const sub = { close: () => finish() };
      handles.add(sub);
      try {
        listeners.push(port.addListener('remoteFrame', event => {
          if (ended || closed || event.subscriptionId !== subscriptionId) return;
          let frame: unknown;
          try {
            if (typeof event.frame !== 'string' || utf8Bytes(event.frame) > 65536) throw new Error();
            frame = JSON.parse(event.frame);
          } catch { finish('frame_invalid'); return; }
          try {
            onFrame(frame);
            if (!ended && !closed) port.acknowledgeFrame(subscriptionId);
          } catch { finish('frame_invalid'); }
        }));
        listeners.push(port.addListener('remoteClosed', event => { if (event.subscriptionId === subscriptionId) finish('stream_closed'); }));
        listeners.push(port.addListener('remoteOpened', event => { if (!ended && !closed && event.subscriptionId === subscriptionId) onOpen?.(); }));
        port.subscribe(handle, subscriptionId, encode(request));
      } catch { finish('transport_unavailable'); }
      return sub;
    },
  };
  const client = new TypedRemoteClient({ credentials, crypto, transport });
  return {
    client, crypto, transport, stream, credentials,
    close() {
      if (closed) return;
      closed = true;
      for (const sub of [...handles]) sub.close();
      port.deactivate(handle);
    },
  };
}
