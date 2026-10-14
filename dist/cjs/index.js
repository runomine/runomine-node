"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uuidv7 = exports.isPageview = exports.fromNodeRequest = exports.fromRequest = exports.visitorHashAsync = exports.visitorHash = exports.Client = void 0;
exports.createClient = createClient;
exports.defaultClient = defaultClient;
exports.init = init;
exports.visitorFor = visitorFor;
exports.checkoutMetadata = checkoutMetadata;
exports.pageview = pageview;
exports.sample = sample;
exports.samples = samples;
exports.track = track;
exports.flush = flush;
exports.shutdown = shutdown;
exports.express = express;
// @runomine/node: cookieless, server-side analytics for runomine.
const node_crypto_1 = require("node:crypto");
const client_js_1 = require("./client.js");
Object.defineProperty(exports, "Client", { enumerable: true, get: function () { return client_js_1.Client; } });
const express_js_1 = require("./express.js");
const hash_node_js_1 = require("./hash-node.js");
Object.defineProperty(exports, "visitorHash", { enumerable: true, get: function () { return hash_node_js_1.visitorHash; } });
const hash_web_js_1 = require("./hash-web.js");
Object.defineProperty(exports, "visitorHashAsync", { enumerable: true, get: function () { return hash_web_js_1.visitorHashAsync; } });
const context_js_1 = require("./context.js");
Object.defineProperty(exports, "fromNodeRequest", { enumerable: true, get: function () { return context_js_1.fromNodeRequest; } });
Object.defineProperty(exports, "fromRequest", { enumerable: true, get: function () { return context_js_1.fromRequest; } });
Object.defineProperty(exports, "isPageview", { enumerable: true, get: function () { return context_js_1.isPageview; } });
const nodePlatform = {
    name: 'node',
    hash: hash_node_js_1.visitorHash,
    random: (length) => (0, node_crypto_1.randomFillSync)(new Uint8Array(length)),
};
/** A client with its own config and queue. Missing options come from RUNOMINE_TOKEN / RUNOMINE_URL / RUNOMINE_ENABLED. */
function createClient(options = {}) {
    return new client_js_1.Client(options, nodePlatform);
}
/** The client configured from the environment, created on first use. */
function defaultClient() {
    return (0, client_js_1.getDefaultClient)(nodePlatform);
}
/** Configures the default client in code instead of the environment. Returns it. */
function init(options = {}) {
    const client = createClient(options);
    (0, client_js_1.setDefaultClient)(nodePlatform, client);
    return client;
}
/**
 * The visitor hash of a request, with the default client's token (synchronous). Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook or job that has no request. `undefined` without a token or a request.
 */
function visitorFor(request, day) {
    try {
        return defaultClient().visitorFor(request, day);
    }
    catch {
        return undefined;
    }
}
/**
 * What to pass to your payment provider when creating a checkout, so runomine attributes the sale:
 * `{ runomine_visitor, runomine_user }`, only the keys with a value. Takes an Express/Node request or a
 * Fetch `Request`; `user` is your user id. No visitor without a token or the request's IP. Never throws.
 *
 *   stripe.checkout.sessions.create({ ..., metadata: checkoutMetadata(req, { user: req.user?.id }) })
 */
function checkoutMetadata(request, options = {}) {
    try {
        return defaultClient().checkoutMetadata(request, options);
    }
    catch {
        const user = options?.user;
        return user === null || user === undefined || user === '' ? {} : { runomine_user: String(user) };
    }
}
/** Records a pageview with the default client. See Client.pageview, with optional props: `pageview(req, { props: { section: 'news' } })`. */
function pageview(input, options) {
    try {
        defaultClient().pageview(input, options);
    }
    catch {
        // never throws
    }
}
/** Sends one sample of the app's own ops numbers with the default client, at once. See Client.sample. */
function sample(data, ts) {
    try {
        return defaultClient().sample(data, ts);
    }
    catch {
        return Promise.resolve(false);
    }
}
/** Sends several samples with the default client. See Client.samples. */
function samples(list) {
    try {
        return defaultClient().samples(list);
    }
    catch {
        return Promise.resolve(false);
    }
}
/** Records a business event with the default client. See Client.track. */
function track(name, props, options) {
    try {
        defaultClient().track(name, props, options);
    }
    catch {
        // never throws
    }
}
/** Sends everything queued by the default client. Never rejects. */
function flush() {
    try {
        return defaultClient().flush();
    }
    catch {
        return Promise.resolve();
    }
}
/** Flushes and stops the default client. Call it before `process.exit()`. */
function shutdown() {
    try {
        return defaultClient().shutdown();
    }
    catch {
        return Promise.resolve();
    }
}
/**
 * Express middleware: `app.use(runomine.express())`. Records GET requests answered 200 with text/html,
 * after the response is sent.
 */
function express(options = {}) {
    return (0, express_js_1.createExpressMiddleware)(options, defaultClient);
}
var util_js_1 = require("./util.js");
Object.defineProperty(exports, "uuidv7", { enumerable: true, get: function () { return util_js_1.uuidv7; } });
const runomine = {
    createClient,
    defaultClient,
    init,
    pageview,
    track,
    sample,
    samples,
    flush,
    shutdown,
    express,
    visitorHash: hash_node_js_1.visitorHash,
    visitorHashAsync: hash_web_js_1.visitorHashAsync,
    visitorFor,
    checkoutMetadata,
    fromRequest: context_js_1.fromRequest,
    fromNodeRequest: context_js_1.fromNodeRequest,
    isPageview: context_js_1.isPageview,
};
exports.default = runomine;
