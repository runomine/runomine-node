/**
 * The runomine visitor hash, synchronous, with node:crypto.
 *
 *   salt    = hex(HMAC-SHA256(key = token, message = "runomine:" + day))
 *   visitor = first 16 hex chars of hex(SHA256(salt + "|" + ip + "|" + user_agent + "|" + host))
 *
 * `day` defaults to the current UTC date; a Date, a timestamp or a "YYYY-MM-DD" string are accepted.
 * `host` is lowercased and stripped of its port.
 */
export declare function visitorHash(token: string, ip: string, userAgent: string, host: string, day?: string | Date | number): string;
