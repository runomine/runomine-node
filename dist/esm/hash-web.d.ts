interface Subtle {
    importKey(format: 'raw', key: Uint8Array, algorithm: unknown, extractable: boolean, usages: string[]): Promise<unknown>;
    sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
    digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}
/** Web Crypto's SubtleCrypto: the global one, else Node's `webcrypto` (Node 18 has no global `crypto`). */
export declare function getSubtle(): Promise<Subtle>;
/** Same as visitorHash() but with an explicit SubtleCrypto; used by tests to pin the implementation. */
export declare function visitorHashWith(subtle: Subtle, token: string, ip: string, userAgent: string, host: string, day?: string | Date | number): Promise<string>;
/**
 * The runomine visitor hash, asynchronous, with Web Crypto. Works on Node 18+ and on Edge runtimes,
 * and gives exactly the same value as the synchronous visitorHash().
 */
export declare function visitorHashAsync(token: string, ip: string, userAgent: string, host: string, day?: string | Date | number): Promise<string>;
export {};
