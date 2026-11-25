/** Frozen remote-v1 transport policy. No generic URL or HTTP surface. */
import type { DeviceCredentials, Scope, SignedRequest } from './types';
import { OPERATIONS } from './client';
import { b64urlDecode, b64urlEncode, canonicalJson, isOpaqueId, isUuid, sha256hex, utf8Bytes } from './wire';

export const SCOPES: readonly Scope[] = ['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond'];
export type ConnectionCode = 'disabled' | 'pairing_required' | 'invalid_request' | 'pin_mismatch' | 'transport_unavailable' | 'stream_closed' | 'frame_invalid' | 'capacity_exceeded';
export class ConnectionError extends Error {
  constructor(readonly code: ConnectionCode) { super(code); this.name = 'RemoteConnectionError'; }
}
export interface RemoteBootstrap {
  protocolVersion: 1;
  endpoint: string;
  serviceFingerprint: string;
  servicePublicKey: string;
  pairingSessionId: string;
  pairCode: string;
  expiresAt: string;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(value, k)); }
function reject(): never { throw new ConnectionError('invalid_request'); }
export function validBase64Url(value: unknown, length: number): value is string {
  if (typeof value !== 'string') return false;
  const bytes = b64urlDecode(value, length);
  return bytes !== null && b64urlEncode(bytes) === value;
}
export function validateEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 320 || !/^https:\/\/[a-z0-9.:[\]-]+\/?$/.test(value)) return reject();
  let url: URL;
  try { url = new URL(value); } catch { return reject(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return reject();
  const host = url.hostname;
  const ip4 = /^(100)\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  const tail4 = ip4 !== null && Number(ip4[2]) >= 64 && Number(ip4[2]) <= 127
    && ip4.slice(2).every(v => String(Number(v)) === v && Number(v) <= 255);
  const tail6 = /^\[fd7a:115c:a1e0:[0-9a-f:]+\]$/.test(host);
  const dns = host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/.test(host);
  if ((!tail4 && !tail6 && !dns) || (url.port && (!/^\d{1,5}$/.test(url.port) || Number(url.port) < 1))) return reject();
  // The endpoint is an origin, never a base path or a URI to resolve user text against.
  return url.origin;
}
export function validScopes(value: unknown): value is Scope[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= 7
    && value.every(s => SCOPES.includes(s as Scope)) && new Set(value).size === value.length
    && value.includes('projects.read') && value.includes('sessions.read');
}
export function strictFutureInstant(value: unknown, now = Date.now()): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const ms = Date.parse(value);
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  return Number.isFinite(ms) && ms > now && new Date(ms).toISOString() === normalized;
}
export function validateBootstrap(value: unknown, now = Date.now()): RemoteBootstrap {
  const keys = ['protocolVersion', 'endpoint', 'serviceFingerprint', 'servicePublicKey', 'pairingSessionId', 'pairCode', 'expiresAt'];
  if (!record(value) || !exact(value, keys) || value.protocolVersion !== 1
    || typeof value.serviceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.serviceFingerprint)
    || !validBase64Url(value.servicePublicKey, 32)
    || !validBase64Url(value.pairingSessionId, 16)
    || typeof value.pairCode !== 'string' || !/^[0-9]{6}$/.test(value.pairCode)
    || !strictFutureInstant(value.expiresAt, now) || Date.parse(value.expiresAt) - now > 120_000) return reject();
  return { ...value, endpoint: validateEndpoint(value.endpoint) } as unknown as RemoteBootstrap;
}
export function validateCredentials(value: unknown, now = Date.now()): DeviceCredentials {
  if (!record(value) || !exact(value, ['deviceId', 'devicePublicKey', 'grantedScopes', 'replayEpoch', 'expiresAt', 'serviceFingerprint', 'serviceId', 'servicePublicKey'])
    || !isOpaqueId(value.deviceId) || !validScopes(value.grantedScopes)
    || !Number.isSafeInteger(value.replayEpoch) || (value.replayEpoch as number) < 1
    || !strictFutureInstant(value.expiresAt, now)
    || !validBase64Url(value.devicePublicKey, 32)
    || !validBase64Url(value.servicePublicKey, 32)
    || typeof value.serviceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.serviceFingerprint)
    || value.serviceId !== 'svc-' + value.serviceFingerprint.slice(0, 16)) return reject();
  return structuredClone(value) as unknown as DeviceCredentials;
}
const SIGNED = ['x-pi-remote-device', 'x-pi-remote-epoch', 'x-pi-remote-request-id', 'x-pi-remote-timestamp', 'x-pi-remote-nonce', 'x-pi-remote-body-sha256', 'x-pi-remote-signature'];
export function validateTransportRequest(request: SignedRequest, stream: boolean): void {
  const r = request as unknown;
  if (!record(r) || Object.keys(r).some(k => !['method', 'path', 'query', 'headers', 'rawBody'].includes(k))
    || typeof request.rawBody !== 'string' || utf8Bytes(request.rawBody) > 262144 || !record(request.headers)) return reject();
  if (stream) {
    if (request.method !== 'GET' || request.path !== '/remote/v1/events') return reject();
    if (request.query !== undefined && (!record(request.query) || !exact(request.query, ['cursor']) || !/^[A-Za-z0-9_-]{1,128}$/.test(request.query.cursor ?? ''))) return reject();
  } else {
    if (request.query !== undefined) return reject();
    const allowed = Object.values(OPERATIONS).some(op => {
      if (op.method !== request.method) return false;
      const pieces = op.path.split(/(\{[^}]+\})/);
      const pattern = pieces.map(p => p.startsWith('{') ? '([A-Za-z0-9_-]{8,128})' : p).join('');
      const match = new RegExp('^' + pattern + '$').exec(request.path);
      return match !== null && match.slice(1).every(id => id !== 'stream-reset');
    });
    if (!allowed) return reject();
  }
  const h = request.headers;
  const keys = [...SIGNED, 'accept', ...(request.method === 'POST' ? ['content-type'] : [])];
  if (!exact(h, keys) || Object.values(h).some(v => typeof v !== 'string' || /[\r\n\x00]/.test(v))
    || !isOpaqueId(h['x-pi-remote-device']) || !isUuid(h['x-pi-remote-request-id'])
    || !/^[1-9][0-9]{0,15}$/.test(h['x-pi-remote-epoch'] ?? '')
    || !/^[0-9]{1,16}$/.test(h['x-pi-remote-timestamp'] ?? '')
    || !validBase64Url(h['x-pi-remote-nonce'], 32)
    || !validBase64Url(h['x-pi-remote-signature'], 64)
    || h['x-pi-remote-body-sha256'] !== sha256hex(request.rawBody)
    || h.accept !== (stream ? 'text/event-stream' : 'application/json')) return reject();
  if (request.method === 'GET') { if (request.rawBody !== '') return reject(); }
  else {
    if (h['content-type'] !== 'application/json; charset=utf-8') return reject();
    let body: unknown;
    try { body = JSON.parse(request.rawBody); } catch { return reject(); }
    if (!record(body) || canonicalJson(body) !== request.rawBody) return reject();
  }
}
