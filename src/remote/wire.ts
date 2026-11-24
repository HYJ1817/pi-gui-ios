/**
 * Wire-level validation + canonical encoding for the remote/v1 mobile surface.
 * Mirrors the frozen contract (docs/contracts/remote-v1.json) and the desktop
 * reference validator scripts/lib/remote-protocol-contract.mjs — same closed
 * shapes, same fail-closed posture, no dependency on Node built-ins so the
 * module bundles under Metro.
 */

const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/;
export const isOpaqueId = (value: unknown): value is string => typeof value === 'string' && OPAQUE_ID.test(value);
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Canonical JSON: lexicographically sorted keys, compact separators. */
export function canonicalJson(value: unknown, depth = 0, seen = new Set<unknown>()): string | null {
  if (depth > 16) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    const out = `[${value.map(item => canonicalJson(item, depth + 1, seen)).join(',')}]`;
    seen.delete(value);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return null;
    seen.add(value);
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const inner = canonicalJson((value as Record<string, unknown>)[key], depth + 1, seen);
      if (inner === null) { seen.delete(value); return null; }
      parts.push(`${JSON.stringify(key)}:${inner}`);
    }
    seen.delete(value);
    return `{${parts.join(',')}}`;
  }
  return null;
}

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
const hex = (bytes: number[]): string => bytes.map(b => b.toString(16).padStart(2, '0')).join('');

// DJB2-free SHA-256 — compact, dependency-free implementation used ONLY for
// body digests inside the signed message and synthetic signature material.
// Real signature verification uses the platform crypto adapter.
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
export function sha256hex(input: string | number[]): string {
  const bytes = typeof input === 'string' ? [...new TextEncoder().encode(input)] : input.slice();
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) % 256);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  for (let block = 0; block < bytes.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((bytes[block + i * 4]! << 24) | (bytes[block + i * 4 + 1]! << 16) | (bytes[block + i * 4 + 2]! << 8) | bytes[block + i * 4 + 3]!) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = (((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^ ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^ (w[i - 15]! >>> 3)) >>> 0;
      const s1 = (((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^ ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^ (w[i - 2]! >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const s1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return hex([h0, h1, h2, h3, h4, h5, h6, h7].flatMap(v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64urlEncode(bytes: number[] | Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '') + (i + 2 < bytes.length ? B64[n & 63]! : '');
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64decodeBinary(text: string): string | null {
  // Pure-JS base64 (standard alphabet expected after caller normalizes -_).
  const clean = text.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) return null;
  let out = '';
  let acc = 0, bits = 0;
  for (const ch of clean) {
    const v = B64_CHARS.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 0xff); }
  }
  return out;
}

export function b64urlDecode(text: string, expectedBytes?: number): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bin = b64decodeBinary(text.replace(/-/g, '+').replace(/_/g, '/'));
  if (bin === null || (expectedBytes !== undefined && bin.length !== expectedBytes)) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return expectedBytes === undefined || out.length === expectedBytes ? out : null;
}
export function hexDecode(text: string, expectedBytes?: number): Uint8Array | null {
  if (!/^[0-9a-f]+$/.test(text) || text.length % 2) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return expectedBytes === undefined || out.length === expectedBytes ? out : null;
}

/** Contract maxTranscriptSerializedBytes: measured on the JSON-serialized
 * representation of the text (quotes + escapes included), not raw UTF-8. */
export function serializedJsonBytes(value: unknown): number {
  const json = canonicalJson(value);
  return json === null ? Number.POSITIVE_INFINITY : utf8Bytes(json);
}

// ---- projection policy scans (mirroring scripts/lib/remote-protocol-contract.mjs) ----

const FORBIDDEN_KEYS = new Set(['command', 'args', 'path', 'file', 'sessionpath', 'filepath', 'projectpath', 'cwd', 'url', 'headers', 'env', 'token', 'authorization', 'piguitoken', 'apikey', 'secret', 'credential']);
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '').replace(/[^a-z0-9]/g, '');
export function isForbiddenKey(key: string): boolean {
  const n = normalizeKey(key);
  return FORBIDDEN_KEYS.has(n) || n.endsWith('filepath') || n.endsWith('sessionpath')
    || n.endsWith('token') || n.endsWith('apikey') || n.endsWith('secret') || n.endsWith('credential') || n.endsWith('password');
}

const FORBIDDEN_VALUE = new RegExp([
  /(?:^|[^A-Za-z0-9_.\/~])\/(?!\/)/.source,
  /\w+:\/\/+[A-Za-z]:[\\/]/.source,
  /\w+:\/\/\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+/.source,
  /\/\/+[A-Za-z0-9._~:@-]+\/[A-Za-z0-9._~-]/.source,
  /(?:^|[^A-Za-z0-9_.~\/])(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\\(?=[A-Za-z]))/.source,
  /(?:^|[^A-Za-z0-9_.~\/])(?:home|Users|etc|private|var|opt|root|tmp|usr|bin|srv|mnt|data)[\\/][A-Za-z0-9._-]/.source,
  /(?:PI_GUI_TOKEN|api[_-]?key|oauth[_-]?token|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.source,
  /(?:[Bb]earer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9]{8,})/.source,
  /["']?(?:password|passwd|secret|credential|token|api[_-]?key)["']?\s*[:=]\s*["']?[^\s,;"']+/.source,
  /["']?\b[A-Z][A-Z0-9_]{2,}(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIAL)["']?=["']?\S+/.source,
  /(?:^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]{2,}["']?=["']?[^\s,;"']+/.source,
  /(?:^|[^A-Za-z0-9_.~\/])\\\\[A-Za-z0-9._-]+[\\]/.source,
  /(?:ENOENT|ECONNREFUSED|stack trace|at [A-Za-z]+ \(|Error: )/.source,
].join('|'), 'i');
const CREDENTIAL_VALUE = new RegExp([
  /(?:PI_GUI_TOKEN|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.source,
  /(?:[Bb]earer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9]{8,})/.source,
  /["']?(?:api[_-]?key|oauth[_-]?token|secret|credential|password|passwd|token)["']?\s*[:=]\s*["']?[^\s,;"']+/.source,
  /["']?\b[A-Z][A-Z0-9_]{2,}(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIAL)["']?=["']?\S+/.source,
].join('|'), 'i');
/** Transcript exception paths: raw conversation text tolerates prose but is
 * still credential-scanned (projectionPolicy.transcriptException). */
const TRANSCRIPT_TEXT_PATHS = new Set(['payload.text', 'messages.text', 'payload.messages.text', 'result.messages.text']);
const MAX_SCAN_VALUE_LENGTH = 16384;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 16) return true;
  if (Array.isArray(value)) return value.some(item => hasForbiddenKey(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => isForbiddenKey(key) || hasForbiddenKey(item, depth + 1));
}
export function hasForbiddenValue(value: unknown, depth = 0, path: string[] = []): boolean {
  if (depth > 16) return true;
  if (typeof value === 'string') {
    if (value.length > MAX_SCAN_VALUE_LENGTH) return true;
    const insideTranscript = TRANSCRIPT_TEXT_PATHS.has(path.join('.'));
    return insideTranscript ? CREDENTIAL_VALUE.test(value) : FORBIDDEN_VALUE.test(value);
  }
  if (Array.isArray(value)) return value.some(item => hasForbiddenValue(item, depth + 1, path));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => hasForbiddenValue(item, depth + 1, [...path, key]));
}

/** Deterministic RFC4122-ish v4 UUID from 16 bytes (uuidv4 shape). */
export function uuidFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 16) return null;
  const b = [...bytes.slice(0, 16)];
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
