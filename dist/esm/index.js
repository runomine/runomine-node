// @runomine/node: cookieless, server-side analytics for runomine.
import { randomFillSync } from 'node:crypto';
import { Client, getDefaultClient, setDefaultClient, } from './client.js';
import { createExpressMiddleware } from './express.js';
import { visitorHash } from './hash-node.js';
import { visitorHashAsync } from './hash-web.js';
import { fromNodeRequest, fromRequest, isPageview } from './context.js';
const nodePlatform = {
    name: 'node',
    hash: visitorHash,
    random: (length) => randomFillSync(new Uint8Array(length)),
};
/** A client with its own config and queue. Missing options come from RUNOMINE_TOKEN / RUNOMINE_URL / RUNOMINE_ENABLED. */
export function createClient(options = {}) {
    return new Client(options, nodePlatform);
}
/** The client configured from the environment, created on first use. */
export function defaultClient() {
    return getDefaultClient(nodePlatform);
}
/** Configures the default client in code instead of the environment. Returns it. */
export function init(options = {}) {
    const client = createClient(options);
    setDefaultClient(nodePlatform, client);
    return client;
}
/**
 * The visitor hash of a request, with the default client's token (synchronous). Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook or job that has no request. `undefined` without a token or a request.
 */
export function visitorFor(request, day) {
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
export function checkoutMetadata(request, options = {}) {
    try {
        return defaultClient().checkoutMetadata(request, options);
    }
    catch {
        const user = options?.user;
        return user === null || user === undefined || user === '' ? {} : { runomine_user: String(user) };
    }
}
/** Records a pageview with the default client. See Client.pageview. */
export function pageview(input) {
    try {
        defaultClient().pageview(input);
    }
    catch {
        // never throws
    }
}
/** Records a business event with the default client. See Client.track. */
export function track(name, props, options) {
    try {
        defaultClient().track(name, props, options);
    }
    catch {
        // never throws
    }
}
/** Sends everything queued by the default client. Never rejects. */
export function flush() {
    try {
        return defaultClient().flush();
    }
    catch {
        return Promise.resolve();
    }
}
/** Flushes and stops the default client. Call it before `process.exit()`. */
export function shutdown() {
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
export function express(options = {}) {
    return createExpressMiddleware(options, defaultClient);
}
export { Client, visitorHash, visitorHashAsync, fromRequest, fromNodeRequest, isPageview };
export { uuidv7 } from './util.js';
const runomine = {
    createClient,
    defaultClient,
    init,
    pageview,
    track,
    flush,
    shutdown,
    express,
    visitorHash,
    visitorHashAsync,
    visitorFor,
    checkoutMetadata,
    fromRequest,
    fromNodeRequest,
    isPageview,
};
export default runomine;
