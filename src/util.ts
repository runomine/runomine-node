// Runtime-neutral helpers. Nothing in this file may import a node: module: it is part of the
// Edge-safe graph used by `@runomine/node/next`.

export type MaybePromise<T> = T | Promise<T>;

export function isPromise<T>(value: unknown): value is Promise<T> {
  return !!value && typeof (value as { then?: unknown }).then === 'function';
}

/** Applies `fn` synchronously when `value` is not a promise, so the Node path stays sync. */
export function then<T, R>(value: MaybePromise<T>, fn: (v: T) => MaybePromise<R>): MaybePromise<R> {
  return isPromise<T>(value) ? value.then(fn) : fn(value);
}

/** The UTC day, "YYYY-MM-DD", of a date (default: now) or the string itself when already a day. */
export function utcDay(day?: string | Date | number): string {
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const date = day === undefined ? new Date() : new Date(day);
  return date.toISOString().slice(0, 10);
}

/** Lowercase hostname without port, as the visitor hash expects. Accepts "Example.com:8080" or "[::1]:3000". */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return '';
  let h = String(host).trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(':');
  if (colon !== -1 && colon === h.lastIndexOf(':')) h = h.slice(0, colon);
  return h;
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

export function pathOf(url: string | null | undefined): string {
  if (!url) return '/';
  try {
    return new URL(url, 'http://localhost').pathname || '/';
  } catch {
    return '/';
  }
}

/** "::ffff:203.0.113.9" -> "203.0.113.9", so IPv4 clients hash the same whatever the socket family. */
export function normalizeIp(ip: string | null | undefined): string {
  if (!ip) return '';
  const value = String(ip).trim();
  return value.toLowerCase().startsWith('::ffff:') && value.includes('.') ? value.slice(7) : value;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i]!.toString(16).padStart(2, '0');
  return out;
}

export type RandomBytes = (length: number) => Uint8Array;

/** Random bytes from Web Crypto when the runtime has it (Node 19+, Edge, Deno, Bun). */
export const webRandom: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(bytes);
  // Node 18 without --experimental-global-webcrypto. The id is an idempotency key, not a secret,
  // and it already carries a millisecond timestamp.
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
};

/** UUID version 7 (RFC 9562): 48-bit Unix ms timestamp, then random bits. */
export function uuidv7(random: RandomBytes = webRandom, now: number = Date.now()): string {
  const b = random(16);
  b[0] = Math.floor(now / 2 ** 40) & 0xff;
  b[1] = Math.floor(now / 2 ** 32) & 0xff;
  b[2] = (now >>> 24) & 0xff;
  b[3] = (now >>> 16) & 0xff;
  b[4] = (now >>> 8) & 0xff;
  b[5] = now & 0xff;
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Reads an environment variable without assuming `process` exists (Edge runtimes). */
export function env(name: string): string | undefined {
  try {
    const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
    return value === undefined || value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

export function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (['0', 'false', 'off', 'no', ''].includes(v)) return false;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  return undefined;
}
