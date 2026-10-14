"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitorHash = visitorHash;
const node_crypto_1 = require("node:crypto");
const util_js_1 = require("./util.js");
/**
 * The runomine visitor hash, synchronous, with node:crypto.
 *
 *   salt    = hex(HMAC-SHA256(key = token, message = "runomine:" + day))
 *   visitor = first 16 hex chars of hex(SHA256(salt + "|" + ip + "|" + user_agent + "|" + host))
 *
 * `day` defaults to the current UTC date; a Date, a timestamp or a "YYYY-MM-DD" string are accepted.
 * `host` is lowercased and stripped of its port.
 */
function visitorHash(token, ip, userAgent, host, day) {
    const salt = (0, node_crypto_1.createHmac)('sha256', token).update('runomine:' + (0, util_js_1.utcDay)(day)).digest('hex');
    return (0, node_crypto_1.createHash)('sha256')
        .update(salt + '|' + (ip ?? '') + '|' + (userAgent ?? '') + '|' + (0, util_js_1.normalizeHost)(host))
        .digest('hex')
        .slice(0, 16);
}
