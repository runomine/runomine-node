"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uuidv7 = exports.isPageview = exports.fromRequest = exports.visitorHashAsync = exports.Client = void 0;
exports.createClient = createClient;
exports.defaultClient = defaultClient;
exports.init = init;
exports.track = track;
exports.visitorFor = visitorFor;
exports.checkoutMetadata = checkoutMetadata;
exports.pageview = pageview;
exports.flush = flush;
exports.shutdown = shutdown;
exports.withRunomine = withRunomine;
// @runomine/node/next: Next.js App Router support. Runs on the Edge runtime (middleware.ts) and on
// Node (proxy.ts in Next 16+, route handlers, server actions). Uses Web Crypto; no static node: imports.
const client_js_1 = require("./client.js");
Object.defineProperty(exports, "Client", { enumerable: true, get: function () { return client_js_1.Client; } });
const context_js_1 = require("./context.js");
Object.defineProperty(exports, "fromRequest", { enumerable: true, get: function () { return context_js_1.fromRequest; } });
Object.defineProperty(exports, "isPageview", { enumerable: true, get: function () { return context_js_1.isPageview; } });
const hash_web_js_1 = require("./hash-web.js");
Object.defineProperty(exports, "visitorHashAsync", { enumerable: true, get: function () { return hash_web_js_1.visitorHashAsync; } });
const util_js_1 = require("./util.js");
const webPlatform = {
    name: 'web',
    hash: hash_web_js_1.visitorHashAsync,
    random: util_js_1.webRandom,
};
/** A client with its own config and queue, hashing with Web Crypto. */
function createClient(options = {}) {
    return new client_js_1.Client(options, webPlatform);
}
/** The client configured from the environment, created on first use. */
function defaultClient() {
    return (0, client_js_1.getDefaultClient)(webPlatform);
}
/** Configures the default client in code instead of the environment. Returns it. */
function init(options = {}) {
    const client = createClient(options);
    (0, client_js_1.setDefaultClient)(webPlatform, client);
    return client;
}
/**
 * Records a business event from a route handler or a server action:
 *
 *   track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: session.userId, headers: headers() })
 *
 * In a route handler you can pass `request` instead of `headers`. Returns immediately; never throws.
 */
function track(name, props, options) {
    try {
        const { headers, ...rest } = options ?? {};
        const request = rest.request ??
            (headers ? (0, util_js_1.then)(headers, (h) => (h ? { headers: h } : undefined)) : undefined);
        defaultClient().track(name, props, { ...rest, request });
    }
    catch {
        // never throws
    }
}
/**
 * The visitor hash of a request (or of `headers()`), with the default client's token. Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook that has no request. Resolves to `undefined` without a token or a request.
 */
async function visitorFor(request, day) {
    try {
        const source = await request;
        if (!source)
            return undefined;
        const req = typeof source.get === 'function' ? { headers: source } : source;
        return await defaultClient().visitorFor(req, day);
    }
    catch {
        return undefined;
    }
}
/**
 * What to pass to your payment provider when creating a checkout (`{ runomine_visitor, runomine_user }`, only
 * the keys with a value), from a route handler's `request` or a server action's `headers()`:
 *
 *   const metadata = await checkoutMetadata(headers(), { user: session.userId })
 *
 * No visitor without a token or the request's IP. Never rejects.
 */
async function checkoutMetadata(request, options = {}) {
    let req;
    try {
        const source = await request;
        if (source)
            req = typeof source.get === 'function' ? { headers: source } : source;
    }
    catch {
        // no request: no visitor
    }
    try {
        return await defaultClient().checkoutMetadata(req, options);
    }
    catch {
        const user = options?.user;
        return user === null || user === undefined || user === '' ? {} : { runomine_user: String(user) };
    }
}
/** Records a pageview with the default client. */
function pageview(input) {
    try {
        defaultClient().pageview(input);
    }
    catch {
        // never throws
    }
}
/** Sends everything queued. Use with `after(() => flush())` or `await flush()` on serverless. Never rejects. */
function flush() {
    try {
        return defaultClient().flush();
    }
    catch {
        return Promise.resolve();
    }
}
function shutdown() {
    try {
        return defaultClient().shutdown();
    }
    catch {
        return Promise.resolve();
    }
}
const ALWAYS_IGNORED = ['/_next', '/_vercel'];
function record(request, response, event, options) {
    const path = (0, util_js_1.pathOf)(request.url);
    if ((0, context_js_1.isIgnored)(path, ALWAYS_IGNORED))
        return;
    const res = response && typeof response === 'object' && 'status' in response ? response : undefined;
    if (!(0, context_js_1.isPageview)(request, res, { ignore: options.ignore ?? ['/api'] }))
        return;
    const client = options.client ?? defaultClient();
    if (!client.enabled)
        return;
    const ctx = (0, context_js_1.fromRequest)(request, { ip: options.ip ? options.ip(request) : undefined });
    const user = options.user ? options.user(request) : undefined;
    client.pageview((0, util_js_1.then)(user, (u) => ({ ...ctx, user: u ?? undefined })));
    const flushing = client.flush();
    if (event && typeof event.waitUntil === 'function')
        event.waitUntil(flushing);
}
function withRunomine(middlewareOrOptions, maybeOptions) {
    const middleware = typeof middlewareOrOptions === 'function' ? middlewareOrOptions : undefined;
    const options = (typeof middlewareOrOptions === 'function' ? maybeOptions : middlewareOrOptions) ?? {};
    return async function runomineMiddleware(request, event) {
        const response = middleware ? await middleware(request, event) : undefined;
        try {
            record(request, response, event ?? undefined, options);
        }
        catch {
            // analytics must never break the app
        }
        return response;
    };
}
var util_js_2 = require("./util.js");
Object.defineProperty(exports, "uuidv7", { enumerable: true, get: function () { return util_js_2.uuidv7; } });
const runomine = { createClient, defaultClient, init, track, pageview, flush, shutdown, withRunomine, visitorFor, checkoutMetadata, visitorHashAsync: hash_web_js_1.visitorHashAsync, fromRequest: context_js_1.fromRequest, isPageview: context_js_1.isPageview };
exports.default = runomine;
