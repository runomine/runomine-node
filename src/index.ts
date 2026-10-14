// @runomine/node: cookieless, server-side analytics for runomine.
import { randomFillSync } from 'node:crypto';
import {
  Client,
  getDefaultClient,
  setDefaultClient,
  type CheckoutMetadata,
  type CheckoutMetadataOptions,
  type ClientOptions,
  type PageviewInput,
  type Platform,
  type Props,
  type TrackOptions,
} from './client.js';
import type { NodeRequestLike, RequestSource } from './context.js';
import { createExpressMiddleware, type ExpressOptions, type ExpressResponseLike } from './express.js';
import { visitorHash } from './hash-node.js';
import { visitorHashAsync } from './hash-web.js';
import { fromNodeRequest, fromRequest, isPageview } from './context.js';
import type { MaybePromise } from './util.js';

const nodePlatform: Platform = {
  name: 'node',
  hash: visitorHash,
  random: (length) => randomFillSync(new Uint8Array(length)),
};

/** A client with its own config and queue. Missing options come from RUNOMINE_TOKEN / RUNOMINE_URL / RUNOMINE_ENABLED. */
export function createClient(options: ClientOptions = {}): Client {
  return new Client(options, nodePlatform);
}

/** The client configured from the environment, created on first use. */
export function defaultClient(): Client {
  return getDefaultClient(nodePlatform);
}

/** Configures the default client in code instead of the environment. Returns it. */
export function init(options: ClientOptions = {}): Client {
  const client = createClient(options);
  setDefaultClient(nodePlatform, client);
  return client;
}

/**
 * The visitor hash of a request, with the default client's token (synchronous). Capture it where the
 * visitor is (e.g. at checkout), store it with the order, and pass it as `track(…, { visitor })` from a
 * webhook or job that has no request. `undefined` without a token or a request.
 */
export function visitorFor(request: RequestSource | null | undefined, day?: string | Date | number): string | undefined {
  try {
    return defaultClient().visitorFor(request, day) as string | undefined;
  } catch {
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
export function checkoutMetadata(
  request: RequestSource | null | undefined,
  options: CheckoutMetadataOptions = {},
): CheckoutMetadata {
  try {
    return defaultClient().checkoutMetadata(request, options) as CheckoutMetadata;
  } catch {
    const user = options?.user;
    return user === null || user === undefined || user === '' ? {} : { runomine_user: String(user) };
  }
}

/** Records a pageview with the default client. See Client.pageview. */
export function pageview(input: MaybePromise<PageviewInput | RequestSource | null | undefined>): void {
  try {
    defaultClient().pageview(input);
  } catch {
    // never throws
  }
}

/** Records a business event with the default client. See Client.track. */
export function track(name: string, props?: Props | null, options?: TrackOptions | null): void {
  try {
    defaultClient().track(name, props, options);
  } catch {
    // never throws
  }
}

/** Sends everything queued by the default client. Never rejects. */
export function flush(): Promise<void> {
  try {
    return defaultClient().flush();
  } catch {
    return Promise.resolve();
  }
}

/** Flushes and stops the default client. Call it before `process.exit()`. */
export function shutdown(): Promise<void> {
  try {
    return defaultClient().shutdown();
  } catch {
    return Promise.resolve();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { [key: string]: any };

/**
 * Express middleware: `app.use(runomine.express())`. Records GET requests answered 200 with text/html,
 * after the response is sent.
 */
export function express<Req extends NodeRequestLike = NodeRequestLike & Loose, Res extends ExpressResponseLike = ExpressResponseLike & Loose>(
  options: ExpressOptions<Req, Res> = {},
): (req: Req, res: Res, next: (err?: unknown) => void) => void {
  return createExpressMiddleware(options, defaultClient);
}

export { Client, visitorHash, visitorHashAsync, fromRequest, fromNodeRequest, isPageview };
export { uuidv7 } from './util.js';
export type { ClientOptions, PageviewInput, Props, TrackOptions, ExpressOptions, ExpressResponseLike };
export type { CheckoutMetadata, CheckoutMetadataOptions };
export type { Revenue, WireEvent, FetchLike, FetchResponseLike } from './client.js';
export type {
  RequestContext,
  RequestSource,
  FetchRequestLike,
  NodeRequestLike,
  HeadersLike,
  FromRequestOptions,
  Ignore,
  IgnoreRule,
  ResponseLike,
  IsPageviewOptions,
} from './context.js';

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
