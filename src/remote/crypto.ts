/**
 * Crypto providers for the typed remote client.
 *
 * `SyntheticCryptoProvider` is deterministic and DEPENDENCY-FREE — it exists
 * ONLY for the bundled offline demo surface and the Node sandbox tests that
 * don't need real Ed25519. Its "signature" is a keyed digest over
 * (publicKey | message); anyone holding the public key can recompute it, so it
 * proves possession of nothing. Real Ed25519 lands with the production
 * transport adapter (native crypto module / Node fixtures) — the interface is
 * identical, so the client, gateway and tests exercise one code path.
 */
import type { CryptoProvider } from './types';
import type { GatewayCrypto } from './sandbox';
import { b64urlEncode, sha256hex } from './wire';

export interface SyntheticIdentity { publicKey: string; secret: string }

/** Deterministic synthetic identity: public key is 32 derived bytes (b64url, 43 chars). */
export function syntheticIdentity(seed: string): SyntheticIdentity {
  return { publicKey: b64urlEncode([...new TextEncoder().encode(sha256hex(`key:${seed}`).slice(0, 32))]), secret: `secret:${seed}` };
}

function syntheticDigest(publicKey: string, message: string): string {
  // 64 bytes of deterministic material from two rounds over (key|counter|msg).
  const a = sha256hex(`sig-a:${publicKey}|${message}`);
  const b = sha256hex(`sig-b:${publicKey}|${message}`);
  const bytes: number[] = [];
  for (let i = 0; i < 64; i++) bytes.push(parseInt((a + b).slice(i * 2, i * 2 + 2), 16));
  return b64urlEncode(bytes.slice(0, 64));
}

export class SyntheticCryptoProvider implements CryptoProvider {
  readonly identity: SyntheticIdentity;
  private counter = 0;
  constructor(identity: SyntheticIdentity) { this.identity = identity; }
  sign(message: string): string { return syntheticDigest(this.identity.publicKey, message); }
  verify(publicKeyRaw: string, signature: string, message: string): boolean {
    return signature === syntheticDigest(publicKeyRaw, message);
  }
  randomBytes(length: number): string {
    this.counter += 1;
    const hex = sha256hex(`rand:${this.identity.secret}:${this.counter}:${length}`);
    const bytes: number[] = [];
    for (let i = 0; i < length; i++) bytes.push(parseInt(hex.slice((i * 2) % 60, (i * 2) % 60 + 2), 16));
    return b64urlEncode(bytes);
  }
}

/** Gateway-side crypto over synthetic material: signs with the service key. */
export function syntheticGatewayCrypto(servicePublicKey: string): GatewayCrypto {
  return {
    sign: message => syntheticDigest(servicePublicKey, message),
    verify: (publicKeyRaw, signature, message) => signature === syntheticDigest(publicKeyRaw, message),
  };
}
