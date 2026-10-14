// Express (and Connect-style) pageview middleware. No dependency on express itself: the types are structural.
import type { Client } from './client.js';
import { fromNodeRequest, isAssetPath, isIgnored, isPrefetch, type Ignore, type NodeRequestLike } from './context.js';
import { pathOf } from './util.js';

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
}

/**
 * Records a pageview for every GET answered 200 with text/html, after the response is sent.
 * Skips assets, prefetches and ignored paths. Never throws and never delays the response.
 */
export function createExpressMiddleware<Req extends NodeRequestLike, Res extends ExpressResponseLike>(
  options: ExpressOptions<Req, Res>,
  getClient: () => Client,
): (req: Req, res: Res, next: (err?: unknown) => void) => void {
  return function runomineMiddleware(req, res, next) {
    try {
      if ((req.method ?? 'GET').toUpperCase() === 'GET') {
        const path = req.path ?? pathOf(req.originalUrl ?? req.url);
        const header = (name: string) => {
          const v = req.headers?.[name];
          return Array.isArray(v) ? v[0] : v;
        };
        if (!isAssetPath(path) && !isIgnored(path, options.ignore) && !isPrefetch(header)) {
          res.once('finish', () => {
            try {
              if (res.statusCode !== 200) return;
              const type = res.getHeader('content-type');
              if (!String(Array.isArray(type) ? type[0] : (type ?? '')).includes('text/html')) return;
              const user = options.user ? options.user(req, res) : undefined;
              const ip = options.ip ? options.ip(req) : undefined;
              (options.client ?? getClient()).pageview(fromNodeRequest(req, { user, ip }));
            } catch {
              // analytics must never break the app
            }
          });
        }
      }
    } catch {
      // ignore
    }
    next();
  };
}
