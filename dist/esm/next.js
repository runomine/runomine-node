// @runomine/node/next: Next.js App Router support. Runs on the Edge runtime (middleware.ts) and on
// Node (proxy.ts in Next 16+, route handlers, server actions). Uses Web Crypto; no static node: imports.
import { Client, getDefaultClient, setDefaultClient, } from './client.js';
import { fromRequest, isIgnored, isPageview, } from './context.js';
import { visitorHashAsync } from './hash-web.js';
import { pathOf, then, webRandom } from './util.js';
const webPlatform = {
    name: 'web',
    hash: visitorHashAsync,
    random: webRandom,
};
/** A client with its own config and queue, hashing with Web Crypto. */
export function createClient(options = {}) {
    return new Client(options, webPlatform);
}
/** The client configured from the environment, created on first use. */
export function defaultClient() {
    return getDefaultClient(webPlatform);
}
/** Configures the default client in code instead of the environment. Returns it. */
export function init(options = {}) {
    const client = createClient(options);
    setDefaultClient(webPlatform, client);
    return client;
}
/**
 * Records a business event from a route handler or a server action:
 *
 *   track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: session.userId, headers: headers() })
 *
 * In a route handler you can pass `request` instead of `headers`. Returns immediately; never throws.
 */
export function track(name, props, options) {
    try {
        const { headers, ...rest } = options ?? {};
        const request = rest.request ??
            (headers ? then(headers, (h) => (h ? { headers: h } : undefined)) : undefined);
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
export async function visitorFor(request, day) {
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
export async function checkoutMetadata(request, options = {}) {
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
export function pageview(input) {
    try {
        defaultClient().pageview(input);
    }
    catch {
        // never throws
    }
}
/** Sends everything queued. Use with `after(() => flush())` or `await flush()` on serverless. Never rejects. */
export function flush() {
    try {
        return defaultClient().flush();
    }
    catch {
        return Promise.resolve();
    }
}
export function shutdown() {
    try {
        return defaultClient().shutdown();
    }
    catch {
        return Promise.resolve();
    }
}
const ALWAYS_IGNORED = ['/_next', '/_vercel'];
function record(request, response, event, options) {
    const path = pathOf(request.url);
    if (isIgnored(path, ALWAYS_IGNORED))
        return;
    const res = response && typeof response === 'object' && 'status' in response ? response : undefined;
    if (!isPageview(request, res, { ignore: options.ignore ?? ['/api'] }))
        return;
    const client = options.client ?? defaultClient();
    if (!client.enabled)
        return;
    const ctx = fromRequest(request, { ip: options.ip ? options.ip(request) : undefined });
    const user = options.user ? options.user(request) : undefined;
    client.pageview(then(user, (u) => ({ ...ctx, user: u ?? undefined })));
    const flushing = client.flush();
    if (event && typeof event.waitUntil === 'function')
        event.waitUntil(flushing);
}
export function withRunomine(middlewareOrOptions, maybeOptions) {
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
export { Client, visitorHashAsync, fromRequest, isPageview };
export { uuidv7 } from './util.js';
const runomine = { createClient, defaultClient, init, track, pageview, flush, shutdown, withRunomine, visitorFor, checkoutMetadata, visitorHashAsync, fromRequest, isPageview };
export default runomine;
