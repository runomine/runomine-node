"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubtle = getSubtle;
exports.visitorHashWith = visitorHashWith;
exports.visitorHashAsync = visitorHashAsync;
// The visitor hash with Web Crypto, for Edge runtimes (Next.js middleware, Cloudflare, Deno, Bun).
// Same formula and same output as visitorHash() in hash-node.ts. No static node: import here.
const util_js_1 = require("./util.js");
let subtlePromise;
/** Web Crypto's SubtleCrypto: the global one, else Node's `webcrypto` (Node 18 has no global `crypto`). */
function getSubtle() {
    if (!subtlePromise) {
        const global = globalThis.crypto;
        if (global?.subtle) {
            subtlePromise = Promise.resolve(global.subtle);
        }
        else {
            // A variable specifier plus the ignore hints keep Edge bundlers from trying to resolve node:crypto.
            // This branch only runs on Node 18, where Web Crypto isn't global.
            const specifier = 'node:crypto';
            subtlePromise = Promise.resolve(`${specifier}`).then(s => require(s)).then((m) => m.webcrypto.subtle);
        }
    }
    return subtlePromise;
}
const encoder = new TextEncoder();
/** Same as visitorHash() but with an explicit SubtleCrypto; used by tests to pin the implementation. */
async function visitorHashWith(subtle, token, ip, userAgent, host, day) {
    const key = await subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const salt = (0, util_js_1.toHex)(await subtle.sign('HMAC', key, encoder.encode('runomine:' + (0, util_js_1.utcDay)(day))));
    const input = salt + '|' + (ip ?? '') + '|' + (userAgent ?? '') + '|' + (0, util_js_1.normalizeHost)(host);
    return (0, util_js_1.toHex)(await subtle.digest('SHA-256', encoder.encode(input))).slice(0, 16);
}
/**
 * The runomine visitor hash, asynchronous, with Web Crypto. Works on Node 18+ and on Edge runtimes,
 * and gives exactly the same value as the synchronous visitorHash().
 */
async function visitorHashAsync(token, ip, userAgent, host, day) {
    return visitorHashWith(await getSubtle(), token, ip, userAgent, host, day);
}
