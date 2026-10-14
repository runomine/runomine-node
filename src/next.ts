// @runomine/node/next: Next.js App Router support. Runs on the Edge runtime (middleware.ts) and on
// Node (proxy.ts in Next 16+, route handlers, server actions). Uses Web Crypto; no static node: imports.
import {
  Client,
  getDefaultClient,
  setDefaultClient,
  type CheckoutMetadata,
  type CheckoutMetadataOptions,
  type ClientOptions,
  type PageviewInput,
  type PageviewOptions,
  type Platform,
  type Props,
  type Sample,
  type TrackOptions,
} from './client.js';
import {
  fromRequest,
  isIgnored,
  isPageview,
  type FetchRequestLike,
  type HeadersLike,
  type Ignore,
  type RequestSource,
  type ResponseLike,
} from './context.js';
import { visitorHashAsync } from './hash-web.js';
import { pathOf, then, webRandom, type MaybePromise } from './util.js';

const webPlatform: Platform = {
  name: 'web',
  hash: visitorHashAsync,
  random: webRandom,
};

/** A client with its own config and queue, hashing with Web Crypto. */
export function createClient(options: ClientOptions = {}): Client {
  return new Client(options, webPlatform);
}

/** The client configured from the environment, created on first use. */
export function defaultClient(): Client {
  return getDefaultClient(webPlatform);
}

/** Configures the default client in code instead of the environment. Returns it. */
export function init(options: ClientOptions = {}): Client {
  const client = createClient(options);
  setDefaultClient(webPlatform, client);
  return client;
}

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
export function track(name: string, props?: Props | null, options?: NextTrackOptions | null): void {
  try {
    const { headers, ...rest } = options ?? {};
    const request =
      rest.request ??
      (headers ? then(headers, (h) => (h ? ({ headers: h } as FetchRequestLike) : undefined)) : undefined);
    defaultClient().track(name, props, { ...rest, request });
  } catch {
    // never throws
  }
}

/**
 * The visitor hash of a request (or of `headers()`), with the default client's token. Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook that has no request. Resolves to `undefined` without a token or a request.
 */
export async function visitorFor(
  request: MaybePromise<RequestSource | HeadersLike | null | undefined>,
  day?: string | Date | number,
): Promise<string | undefined> {
  try {
    const source = await request;
    if (!source) return undefined;
    const req = typeof (source as HeadersLike).get === 'function' ? ({ headers: source } as FetchRequestLike) : (source as RequestSource);
    return await defaultClient().visitorFor(req, day);
  } catch {
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
export async function checkoutMetadata(
  request: MaybePromise<RequestSource | HeadersLike | null | undefined>,
  options: CheckoutMetadataOptions = {},
): Promise<CheckoutMetadata> {
  let req: RequestSource | undefined;
  try {
    const source = await request;
    if (source) req = typeof (source as HeadersLike).get === 'function' ? ({ headers: source } as FetchRequestLike) : (source as RequestSource);
  } catch {
    // no request: no visitor
  }
  try {
    return await defaultClient().checkoutMetadata(req, options);
  } catch {
    const user = options?.user;
    return user === null || user === undefined || user === '' ? {} : { runomine_user: String(user) };
  }
}

/** Records a pageview with the default client, with optional props: `pageview(req, { props: { section: 'news' } })`. */
export function pageview(input: MaybePromise<PageviewInput | RequestSource | null | undefined>, options?: PageviewOptions | null): void {
  try {
    defaultClient().pageview(input, options);
  } catch {
    // never throws
  }
}

/** Sends one sample of the app's own ops numbers with the default client, at once. See Client.sample. */
export function sample(data: Record<string, unknown>, ts?: Date | string | number): Promise<boolean> {
  try {
    return defaultClient().sample(data, ts);
  } catch {
    return Promise.resolve(false);
  }
}

/** Sends several samples with the default client. See Client.samples. */
export function samples(list: Iterable<Sample>): Promise<boolean> {
  try {
    return defaultClient().samples(list);
  } catch {
    return Promise.resolve(false);
  }
}

/** Sends everything queued. Use with `after(() => flush())` or `await flush()` on serverless. Never rejects. */
export function flush(): Promise<void> {
  try {
    return defaultClient().flush();
  } catch {
    return Promise.resolve();
  }
}

export function shutdown(): Promise<void> {
  try {
    return defaultClient().shutdown();
  } catch {
    return Promise.resolve();
  }
}

// ---- middleware -------------------------------------------------------------------------------

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

const ALWAYS_IGNORED = ['/_next', '/_vercel'];

function record<Req extends FetchRequestLike>(
  request: Req,
  response: unknown,
  event: FetchEventLike | undefined,
  options: WithRunomineOptions<Req>,
): void {
  const path = pathOf(request.url);
  if (isIgnored(path, ALWAYS_IGNORED)) return;
  const res = response && typeof response === 'object' && 'status' in response ? (response as ResponseLike) : undefined;
  if (!isPageview(request, res, { ignore: options.ignore ?? ['/api'] })) return;
  const client = options.client ?? defaultClient();
  if (!client.enabled) return;
  const ctx = fromRequest(request, { ip: options.ip ? options.ip(request) : undefined });
  const user = options.user ? options.user(request) : undefined;
  client.pageview(then(user, (u) => ({ ...ctx, user: u ?? undefined })));
  const flushing = client.flush();
  if (event && typeof event.waitUntil === 'function') event.waitUntil(flushing);
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
export function withRunomine<Req extends FetchRequestLike = FetchRequestLike, Ev extends FetchEventLike | undefined = FetchEventLike>(
  options?: WithRunomineOptions<Req>,
): (request: Req, event: Ev) => Promise<undefined>;
export function withRunomine<Req extends FetchRequestLike, Ev extends FetchEventLike | undefined, Res>(
  middleware: Middleware<Req, Ev, Res>,
  options?: WithRunomineOptions<Req>,
): (request: Req, event: Ev) => Promise<Res>;
export function withRunomine<Req extends FetchRequestLike, Ev extends FetchEventLike | undefined, Res>(
  middlewareOrOptions?: Middleware<Req, Ev, Res> | WithRunomineOptions<Req>,
  maybeOptions?: WithRunomineOptions<Req>,
): (request: Req, event: Ev) => Promise<Res | undefined> {
  const middleware = typeof middlewareOrOptions === 'function' ? middlewareOrOptions : undefined;
  const options = (typeof middlewareOrOptions === 'function' ? maybeOptions : middlewareOrOptions) ?? {};
  return async function runomineMiddleware(request: Req, event: Ev): Promise<Res | undefined> {
    const response = middleware ? await middleware(request, event) : undefined;
    try {
      record(request, response, event ?? undefined, options);
    } catch {
      // analytics must never break the app
    }
    return response;
  };
}

export { Client, visitorHashAsync, fromRequest, isPageview };
export { uuidv7 } from './util.js';
export type { ClientOptions, PageviewInput, PageviewOptions, Props, Sample, TrackOptions, CheckoutMetadata, CheckoutMetadataOptions };
export type { Revenue, WireEvent, FetchLike, FetchResponseLike } from './client.js';
export type { RequestContext, RequestSource, FetchRequestLike, HeadersLike, Ignore, IgnoreRule, ResponseLike } from './context.js';

const runomine = { createClient, defaultClient, init, track, pageview, sample, samples, flush, shutdown, withRunomine, visitorFor, checkoutMetadata, visitorHashAsync, fromRequest, isPageview };

export default runomine;
