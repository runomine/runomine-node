/** What the library needs from a request. Every field is optional; the IP is only used for the hash. */
export interface RequestContext {
    /** Full URL of the page, e.g. "https://example.com/pricing?utm_source=x". */
    url?: string | null;
    /** The visitor's IP. Hashed on your server, never sent. */
    ip?: string | null;
    userAgent?: string | null;
    referrer?: string | null;
    /** ISO 3166-1 alpha-2, e.g. from CF-IPCountry. */
    country?: string | null;
    /** Hostname for the hash; defaults to the URL's hostname. */
    host?: string | null;
    /** Your own user id, when known. */
    user?: string | number | null;
}
export interface HeadersLike {
    get(name: string): string | null;
}
/** A Fetch API Request (Next.js, Hono, Remix, SvelteKit, Deno, Bun…), or just its headers. */
export interface FetchRequestLike {
    url?: string;
    method?: string;
    headers: HeadersLike;
}
/** A Node IncomingMessage, including Express's request. */
export interface NodeRequestLike {
    method?: string;
    url?: string;
    originalUrl?: string;
    path?: string;
    headers: Record<string, string | string[] | undefined>;
    /** Express: the client IP, honouring `trust proxy`. */
    ip?: string;
    /** Express: the hostname, honouring `trust proxy`. */
    hostname?: string;
    /** Express: "http" or "https", honouring `trust proxy`. */
    protocol?: string;
    socket?: {
        remoteAddress?: string;
        encrypted?: boolean;
    } | null;
}
export type RequestSource = RequestContext | FetchRequestLike | NodeRequestLike;
export interface FromRequestOptions {
    /** The client IP when your framework knows it better than the headers (e.g. SvelteKit's getClientAddress()). */
    ip?: string | null;
    user?: string | number | null;
}
/**
 * Builds a RequestContext from a Fetch API Request (or any `{ url?, headers }`).
 * The IP comes from `options.ip`, else CF-Connecting-IP, X-Real-IP, then the first X-Forwarded-For.
 * With headers only (a Next.js server action), the URL is the Referer, i.e. the page the user was on.
 */
export declare function fromRequest(request: FetchRequestLike, options?: FromRequestOptions): RequestContext;
/**
 * Builds a RequestContext from a Node/Express request. With Express, `req.ip`, `req.hostname` and
 * `req.protocol` already honour your `trust proxy` setting; raw forwarding headers are not trusted.
 */
export declare function fromNodeRequest(req: NodeRequestLike, options?: FromRequestOptions): RequestContext;
/** Any supported source -> RequestContext. Plain objects are taken as a RequestContext already. */
export declare function resolveContext(source: RequestSource | null | undefined): RequestContext;
/** Paths to leave out: a prefix ("/admin" matches "/admin" and "/admin/x"), a RegExp, or a function. */
export type IgnoreRule = string | RegExp;
export type Ignore = IgnoreRule[] | ((path: string) => boolean);
export declare function isIgnored(path: string, ignore: Ignore | undefined): boolean;
/** "/logo.png", "/app.js", "/robots.txt": assets, not pages. "/page.html" still counts. */
export declare function isAssetPath(path: string): boolean;
/**
 * Speculative loads the browser or the framework makes without the user seeing the page:
 * `Purpose: prefetch`, `Sec-Purpose: prefetch;prerender`, `X-Purpose: preview`, `X-Moz: prefetch`,
 * Next.js `Next-Router-Prefetch` and React Server Component fetches (`RSC: 1`).
 */
export declare function isPrefetch(get: (name: string) => string | null | undefined): boolean;
export interface ResponseLike {
    status?: number;
    headers?: HeadersLike;
}
export interface IsPageviewOptions {
    ignore?: Ignore;
}
/**
 * The library's pageview rule for Fetch API frameworks: a GET document request (Accept: text/html), not a
 * prefetch, not an asset or ignored path, and, when the response is given, answered 200 with HTML.
 */
export declare function isPageview(request: FetchRequestLike, response?: ResponseLike | null, options?: IsPageviewOptions): boolean;
