// The visitor hash with Web Crypto, for Edge runtimes (Next.js middleware, Cloudflare, Deno, Bun).
// Same formula and same output as visitorHash() in hash-node.ts. No static node: import here.
import { normalizeHost, toHex, utcDay } from './util.js';

// Minimal shape of SubtleCrypto, so the published types don't depend on the DOM lib.
interface Subtle {
  importKey(format: 'raw', key: Uint8Array, algorithm: unknown, extractable: boolean, usages: string[]): Promise<unknown>;
  sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}

let subtlePromise: Promise<Subtle> | undefined;

/** Web Crypto's SubtleCrypto: the global one, else Node's `webcrypto` (Node 18 has no global `crypto`). */
export function getSubtle(): Promise<Subtle> {
  if (!subtlePromise) {
    const global = (globalThis as { crypto?: { subtle?: Subtle } }).crypto;
    if (global?.subtle) {
      subtlePromise = Promise.resolve(global.subtle);
    } else {
      // A variable specifier plus the ignore hints keep Edge bundlers from trying to resolve node:crypto.
      // This branch only runs on Node 18, where Web Crypto isn't global.
      const specifier = 'node:crypto';
      subtlePromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ specifier).then(
        (m: { webcrypto: { subtle: Subtle } }) => m.webcrypto.subtle,
      );
    }
  }
  return subtlePromise;
}

const encoder = new TextEncoder();

/** Same as visitorHash() but with an explicit SubtleCrypto; used by tests to pin the implementation. */
export async function visitorHashWith(
  subtle: Subtle,
  token: string,
  ip: string,
  userAgent: string,
  host: string,
  day?: string | Date | number,
): Promise<string> {
  const key = await subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const salt = toHex(await subtle.sign('HMAC', key, encoder.encode('runomine:' + utcDay(day))));
  const input = salt + '|' + (ip ?? '') + '|' + (userAgent ?? '') + '|' + normalizeHost(host);
  return toHex(await subtle.digest('SHA-256', encoder.encode(input))).slice(0, 16);
}

/**
 * The runomine visitor hash, asynchronous, with Web Crypto. Works on Node 18+ and on Edge runtimes,
 * and gives exactly the same value as the synchronous visitorHash().
 */
export async function visitorHashAsync(
  token: string,
  ip: string,
  userAgent: string,
  host: string,
  day?: string | Date | number,
): Promise<string> {
  return visitorHashWith(await getSubtle(), token, ip, userAgent, host, day);
}
