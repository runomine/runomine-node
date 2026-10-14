import { fromNodeRequest, isAssetPath, isIgnored, isPrefetch } from './context.js';
import { pathOf } from './util.js';
/**
 * Records a pageview for every GET answered 200 with text/html, after the response is sent.
 * Skips assets, prefetches and ignored paths. Never throws and never delays the response.
 */
export function createExpressMiddleware(options, getClient) {
    return function runomineMiddleware(req, res, next) {
        try {
            if ((req.method ?? 'GET').toUpperCase() === 'GET') {
                const path = req.path ?? pathOf(req.originalUrl ?? req.url);
                const header = (name) => {
                    const v = req.headers?.[name];
                    return Array.isArray(v) ? v[0] : v;
                };
                if (!isAssetPath(path) && !isIgnored(path, options.ignore) && !isPrefetch(header)) {
                    res.once('finish', () => {
                        try {
                            if (res.statusCode !== 200)
                                return;
                            const type = res.getHeader('content-type');
                            if (!String(Array.isArray(type) ? type[0] : (type ?? '')).includes('text/html'))
                                return;
                            const user = options.user ? options.user(req, res) : undefined;
                            const ip = options.ip ? options.ip(req) : undefined;
                            const props = options.props ? options.props(req, res) : undefined;
                            (options.client ?? getClient()).pageview(fromNodeRequest(req, { user, ip }), { props });
                        }
                        catch {
                            // analytics must never break the app
                        }
                    });
                }
            }
        }
        catch {
            // ignore
        }
        next();
    };
}
