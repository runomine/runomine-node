import type { Client, Props } from './client.js';
import { type Ignore, type NodeRequestLike } from './context.js';
export interface ExpressResponseLike {
    statusCode: number;
    getHeader(name: string): number | string | string[] | undefined;
    once(event: 'finish', listener: () => void): unknown;
}
export interface ExpressOptions<Req extends NodeRequestLike = NodeRequestLike, Res extends ExpressResponseLike = ExpressResponseLike> {
    /** Client to use. Default: the default client from the environment. */
    client?: Client;
    /** Paths to leave out: prefixes ("/admin"), RegExps, or a function of the path. Assets (paths with a file extension) are always skipped. */
    ignore?: Ignore;
    /** Your user id for the request, e.g. `(req) => req.user?.id`. Called after the response is sent. */
    user?: (req: Req, res: Res) => string | number | null | undefined;
    /** Override the client IP. Default: `req.ip` (honours Express `trust proxy`), else the socket address. */
    ip?: (req: Req) => string | null | undefined;
    /** The page view's props, e.g. `(req, res) => res.locals.analytics`. Called after the response is sent. */
    props?: (req: Req, res: Res) => Props | null | undefined;
}
/**
 * Records a pageview for every GET answered 200 with text/html, after the response is sent.
 * Skips assets, prefetches and ignored paths. Never throws and never delays the response.
 */
export declare function createExpressMiddleware<Req extends NodeRequestLike, Res extends ExpressResponseLike>(options: ExpressOptions<Req, Res>, getClient: () => Client): (req: Req, res: Res, next: (err?: unknown) => void) => void;
