import { Client, type CheckoutMetadata, type CheckoutMetadataOptions, type ClientOptions, type PageviewInput, type PageviewOptions, type Props, type Sample, type TrackOptions } from './client.js';
import { fromRequest, isPageview, type FetchRequestLike, type HeadersLike, type Ignore, type RequestSource } from './context.js';
import { visitorHashAsync } from './hash-web.js';
import { type MaybePromise } from './util.js';
/** A client with its own config and queue, hashing with Web Crypto. */
export declare function createClient(options?: ClientOptions): Client;
/** The client configured from the environment, created on first use. */
export declare function defaultClient(): Client;
/** Configures the default client in code instead of the environment. Returns it. */
export declare function init(options?: ClientOptions): Client;
export interface NextTrackOptions extends TrackOptions {
    /** `headers()` from next/headers, awaited or not (it is async since Next 15). */
    headers?: MaybePromise<HeadersLike | null | undefined>;
}
/**
 * Records a business event from a route handler or a server action:
 *
 *   track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: session.userId, headers: headers() })
 *
 * In a route handler you can pass `request` instead of `headers`. Returns immediately; never throws.
 */
export declare function track(name: string, props?: Props | null, options?: NextTrackOptions | null): void;
/**
 * The visitor hash of a request (or of `headers()`), with the default client's token. Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook that has no request. Resolves to `undefined` without a token or a request.
 */
export declare function visitorFor(request: MaybePromise<RequestSource | HeadersLike | null | undefined>, day?: string | Date | number): Promise<string | undefined>;
/**
 * What to pass to your payment provider when creating a checkout (`{ runomine_visitor, runomine_user }`, only
 * the keys with a value), from a route handler's `request` or a server action's `headers()`:
 *
 *   const metadata = await checkoutMetadata(headers(), { user: session.userId })
 *
 * No visitor without a token or the request's IP. Never rejects.
 */
export declare function checkoutMetadata(request: MaybePromise<RequestSource | HeadersLike | null | undefined>, options?: CheckoutMetadataOptions): Promise<CheckoutMetadata>;
/** Records a pageview with the default client, with optional props: `pageview(req, { props: { section: 'news' } })`. */
export declare function pageview(input: MaybePromise<PageviewInput | RequestSource | null | undefined>, options?: PageviewOptions | null): void;
/** Sends one sample of the app's own ops numbers with the default client, at once. See Client.sample. */
export declare function sample(data: Record<string, unknown>, ts?: Date | string | number): Promise<boolean>;
/** Sends several samples with the default client. See Client.samples. */
export declare function samples(list: Iterable<Sample>): Promise<boolean>;
/** Sends everything queued. Use with `after(() => flush())` or `await flush()` on serverless. Never rejects. */
export declare function flush(): Promise<void>;
export declare function shutdown(): Promise<void>;
export interface FetchEventLike {
    waitUntil?(promise: Promise<unknown>): void;
}
export interface WithRunomineOptions<Req extends FetchRequestLike = FetchRequestLike> {
    /** Client to use. Default: the default client from the environment. */
    client?: Client;
    /**
     * Paths not to record: prefixes ("/admin"), RegExps or a function of the path. Default `["/api"]`.
     * `/_next/*`, `/_vercel/*` and paths with a file extension are always skipped.
     */
    ignore?: Ignore;
    /** Your user id for the request (e.g. from a session cookie you can read on the Edge). May be async. */
    user?: (request: Req) => MaybePromise<string | number | null | undefined>;
    /** Override the client IP. Default: CF-Connecting-IP, X-Real-IP, then the first X-Forwarded-For. */
    ip?: (request: Req) => string | null | undefined;
}
type Middleware<Req, Ev, Res> = (request: Req, event: Ev) => Res | Promise<Res>;
/**
 * Wraps (or is) your `middleware.ts` / `proxy.ts` and records page navigations server-side:
 * GET document requests (Accept: text/html) that aren't prefetches, assets, `/_next/*` or ignored paths,
 * and that your middleware didn't redirect or answer with something other than 200.
 *
 *   export default withRunomine()
 *   export default withRunomine(async (request) => NextResponse.next(), { ignore: ['/admin'] })
 *
 * Sending uses `event.waitUntil` so the response is never delayed.
 */
export declare function withRunomine<Req extends FetchRequestLike = FetchRequestLike, Ev extends FetchEventLike | undefined = FetchEventLike>(options?: WithRunomineOptions<Req>): (request: Req, event: Ev) => Promise<undefined>;
export declare function withRunomine<Req extends FetchRequestLike, Ev extends FetchEventLike | undefined, Res>(middleware: Middleware<Req, Ev, Res>, options?: WithRunomineOptions<Req>): (request: Req, event: Ev) => Promise<Res>;
export { Client, visitorHashAsync, fromRequest, isPageview };
export { uuidv7 } from './util.js';
export type { ClientOptions, PageviewInput, PageviewOptions, Props, Sample, TrackOptions, CheckoutMetadata, CheckoutMetadataOptions };
export type { Revenue, WireEvent, FetchLike, FetchResponseLike } from './client.js';
export type { RequestContext, RequestSource, FetchRequestLike, HeadersLike, Ignore, IgnoreRule, ResponseLike } from './context.js';
declare const runomine: {
    createClient: typeof createClient;
    defaultClient: typeof defaultClient;
    init: typeof init;
    track: typeof track;
    pageview: typeof pageview;
    sample: typeof sample;
    samples: typeof samples;
    flush: typeof flush;
    shutdown: typeof shutdown;
    withRunomine: typeof withRunomine;
    visitorFor: typeof visitorFor;
    checkoutMetadata: typeof checkoutMetadata;
    visitorHashAsync: typeof visitorHashAsync;
    fromRequest: typeof fromRequest;
    isPageview: typeof isPageview;
};
export default runomine;
