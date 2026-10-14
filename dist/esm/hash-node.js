import { createHash, createHmac } from 'node:crypto';
import { normalizeHost, utcDay } from './util.js';
/**
 * The runomine visitor hash, synchronous, with node:crypto.
 *
 *   salt    = hex(HMAC-SHA256(key = token, message = "runomine:" + day))
 *   visitor = first 16 hex chars of hex(SHA256(salt + "|" + ip + "|" + user_agent + "|" + host))
 *
 * `day` defaults to the current UTC date; a Date, a timestamp or a "YYYY-MM-DD" string are accepted.
 * `host` is lowercased and stripped of its port.
 */
export function visitorHash(token, ip, userAgent, host, day) {
    const salt = createHmac('sha256', token).update('runomine:' + utcDay(day)).digest('hex');
    return createHash('sha256')
        .update(salt + '|' + (ip ?? '') + '|' + (userAgent ?? '') + '|' + normalizeHost(host))
        .digest('hex')
        .slice(0, 16);
}
