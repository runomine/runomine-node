import { Client, type CheckoutMetadata, type CheckoutMetadataOptions, type ClientOptions, type PageviewInput, type Props, type TrackOptions } from './client.js';
import type { NodeRequestLike, RequestSource } from './context.js';
import { type ExpressOptions, type ExpressResponseLike } from './express.js';
import { visitorHash } from './hash-node.js';
import { visitorHashAsync } from './hash-web.js';
import { fromNodeRequest, fromRequest, isPageview } from './context.js';
import type { MaybePromise } from './util.js';
/** A client with its own config and queue. Missing options come from RUNOMINE_TOKEN / RUNOMINE_URL / RUNOMINE_ENABLED. */
export declare function createClient(options?: ClientOptions): Client;
/** The client configured from the environment, created on first use. */
export declare function defaultClient(): Client;
/** Configures the default client in code instead of the environment. Returns it. */
export declare function init(options?: ClientOptions): Client;
/**
 * The visitor hash of a request, with the default client's token (synchronous). Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook or job that has no request. `undefined` without a token or a request.
 */
export declare function visitorFor(request: RequestSource | null | undefined, day?: string | Date | number): string | undefined;
/**
 * What to pass to your payment provider when creating a checkout, so runomine attributes the sale:
 * `{ runomine_visitor, runomine_user }`, only the keys with a value. Takes an Express/Node request or a
 * Fetch `Request`; `user` is your user id. No visitor without a token or the request's IP. Never throws.
 *
 *   stripe.checkout.sessions.create({ ..., metadata: checkoutMetadata(req, { user: req.user?.id }) })
 */
export declare function checkoutMetadata(request: RequestSource | null | undefined, options?: CheckoutMetadataOptions): CheckoutMetadata;
/** Records a pageview with the default client. See Client.pageview. */
export declare function pageview(input: MaybePromise<PageviewInput | RequestSource | null | undefined>): void;
/** Records a business event with the default client. See Client.track. */
export declare function track(name: string, props?: Props | null, options?: TrackOptions | null): void;
/** Sends everything queued by the default client. Never rejects. */
export declare function flush(): Promise<void>;
/** Flushes and stops the default client. Call it before `process.exit()`. */
export declare function shutdown(): Promise<void>;
type Loose = {
    [key: string]: any;
};
/**
 * Express middleware: `app.use(runomine.express())`. Records GET requests answered 200 with text/html,
 * after the response is sent.
 */
export declare function express<Req extends NodeRequestLike = NodeRequestLike & Loose, Res extends ExpressResponseLike = ExpressResponseLike & Loose>(options?: ExpressOptions<Req, Res>): (req: Req, res: Res, next: (err?: unknown) => void) => void;
export { Client, visitorHash, visitorHashAsync, fromRequest, fromNodeRequest, isPageview };
export { uuidv7 } from './util.js';
export type { ClientOptions, PageviewInput, Props, TrackOptions, ExpressOptions, ExpressResponseLike };
export type { CheckoutMetadata, CheckoutMetadataOptions };
export type { Revenue, WireEvent, FetchLike, FetchResponseLike } from './client.js';
export type { RequestContext, RequestSource, FetchRequestLike, NodeRequestLike, HeadersLike, FromRequestOptions, Ignore, IgnoreRule, ResponseLike, IsPageviewOptions, } from './context.js';
declare const runomine: {
    createClient: typeof createClient;
    defaultClient: typeof defaultClient;
    init: typeof init;
    pageview: typeof pageview;
    track: typeof track;
    flush: typeof flush;
    shutdown: typeof shutdown;
    express: typeof express;
    visitorHash: typeof visitorHash;
    visitorHashAsync: typeof visitorHashAsync;
    visitorFor: typeof visitorFor;
    checkoutMetadata: typeof checkoutMetadata;
    fromRequest: typeof fromRequest;
    fromNodeRequest: typeof fromNodeRequest;
    isPageview: typeof isPageview;
};
export default runomine;
