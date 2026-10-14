export type MaybePromise<T> = T | Promise<T>;
export declare function isPromise<T>(value: unknown): value is Promise<T>;
/** Applies `fn` synchronously when `value` is not a promise, so the Node path stays sync. */
export declare function then<T, R>(value: MaybePromise<T>, fn: (v: T) => MaybePromise<R>): MaybePromise<R>;
/** The UTC day, "YYYY-MM-DD", of a date (default: now) or the string itself when already a day. */
export declare function utcDay(day?: string | Date | number): string;
/** Lowercase hostname without port, as the visitor hash expects. Accepts "Example.com:8080" or "[::1]:3000". */
export declare function normalizeHost(host: string | null | undefined): string;
export declare function hostOf(url: string | null | undefined): string;
export declare function pathOf(url: string | null | undefined): string;
/** "::ffff:203.0.113.9" -> "203.0.113.9", so IPv4 clients hash the same whatever the socket family. */
export declare function normalizeIp(ip: string | null | undefined): string;
export declare function toHex(bytes: ArrayBuffer | Uint8Array): string;
export type RandomBytes = (length: number) => Uint8Array;
/** Random bytes from Web Crypto when the runtime has it (Node 19+, Edge, Deno, Bun). */
export declare const webRandom: RandomBytes;
/** UUID version 7 (RFC 9562): 48-bit Unix ms timestamp, then random bits. */
export declare function uuidv7(random?: RandomBytes, now?: number): string;
/** Reads an environment variable without assuming `process` exists (Edge runtimes). */
export declare function env(name: string): string | undefined;
export declare function parseBool(value: string | undefined): boolean | undefined;
