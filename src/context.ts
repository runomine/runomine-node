// Turning the requests of different frameworks into the few facts a pageview needs.
// Edge-safe: no node: imports. No classification here: runomine does sources, bots and devices.
import { hostOf, normalizeHost, normalizeIp, pathOf } from './util.js';

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
  socket?: { remoteAddress?: string; encrypted?: boolean } | null;
}

export type RequestSource = RequestContext | FetchRequestLike | NodeRequestLike;

export interface FromRequestOptions {
  /** The client IP when your framework knows it better than the headers (e.g. SvelteKit's getClientAddress()). */
  ip?: string | null;
  user?: string | number | null;
}

const COUNTRY_HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-vercel-ip-country'];

function country(get: (name: string) => string | null | undefined): string | undefined {
  for (const name of COUNTRY_HEADERS) {
    const value = get(name)?.trim().toUpperCase();
    // "XX" is Cloudflare's unknown; anything not two letters (e.g. "T1" for Tor) isn't a country.
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX') return value;
  }
  return undefined;
}

function firstForwarded(value: string | null | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * The URL the visitor asked for. A self-hosted server (e.g. `next start` behind a proxy) builds `request.url`
 * from the address it listens on ("http://localhost:3000/…"); the X-Forwarded-Host / Host header says which
 * site it really is, so the host (and with it the visitor hash) matches the beacon's.
 */
function publicUrl(url: string, get: (name: string) => string | null): string {
  const header = firstForwarded(get('x-forwarded-host')) ?? get('host')?.trim();
  if (!header) return url;
  try {
    const u = new URL(url);
    if (normalizeHost(header) === normalizeHost(u.hostname)) return url;
    const proto = (firstForwarded(get('x-forwarded-proto')) ?? u.protocol).replace(/:$/, '');
    return `${proto}://${header}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Builds a RequestContext from a Fetch API Request (or any `{ url?, headers }`).
 * The IP comes from `options.ip`, else CF-Connecting-IP, X-Real-IP, then the first X-Forwarded-For.
 * With headers only (a Next.js server action), the URL is the Referer, i.e. the page the user was on.
 */
export function fromRequest(request: FetchRequestLike, options: FromRequestOptions = {}): RequestContext {
  const get = (name: string) => {
    try {
      return request.headers.get(name);
    } catch {
      return null;
    }
  };
  const referer = get('referer');
  const url = request.url ? publicUrl(request.url, get) : referer || undefined;
  const ip =
    options.ip ??
    get('cf-connecting-ip') ??
    get('x-real-ip') ??
    firstForwarded(get('x-forwarded-for')) ??
    (request as { ip?: string }).ip; // Next.js <= 14 NextRequest.ip
  return {
    url,
    ip: normalizeIp(ip),
    userAgent: get('user-agent') ?? undefined,
    referrer: request.url ? (referer ?? undefined) : undefined,
    country: country(get),
    host: hostOf(url) || normalizeHost(get('host')),
    user: options.user ?? undefined,
  };
}

/**
 * Builds a RequestContext from a Node/Express request. With Express, `req.ip`, `req.hostname` and
 * `req.protocol` already honour your `trust proxy` setting; raw forwarding headers are not trusted.
 */
export function fromNodeRequest(req: NodeRequestLike, options: FromRequestOptions = {}): RequestContext {
  const headers = req.headers || {};
  const get = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const hostHeader = get('host') ?? '';
  const hostname = normalizeHost(req.hostname || hostHeader);
  // Keep the port from the Host header unless a proxy rewrote the hostname.
  const urlHost = hostHeader && normalizeHost(hostHeader) === hostname ? hostHeader : hostname;
  const protocol = (req.protocol || (req.socket?.encrypted ? 'https' : 'http')).replace(/:$/, '');
  const path = req.originalUrl ?? req.url ?? '/';
  const url = urlHost ? `${protocol}://${urlHost}${path.startsWith('/') ? path : '/' + path}` : undefined;
  return {
    url,
    ip: normalizeIp(options.ip ?? req.ip ?? req.socket?.remoteAddress),
    userAgent: get('user-agent'),
    referrer: get('referer') ?? get('referrer'),
    country: country(get),
    host: hostname,
    user: options.user ?? undefined,
  };
}

/** Any supported source -> RequestContext. Plain objects are taken as a RequestContext already. */
export function resolveContext(source: RequestSource | null | undefined): RequestContext {
  if (!source || typeof source !== 'object') return {};
  const headers = (source as { headers?: unknown }).headers;
  if (headers && typeof (headers as HeadersLike).get === 'function') return fromRequest(source as FetchRequestLike);
  if (headers && typeof headers === 'object') return fromNodeRequest(source as NodeRequestLike);
  return source as RequestContext;
}

/** Paths to leave out: a prefix ("/admin" matches "/admin" and "/admin/x"), a RegExp, or a function. */
export type IgnoreRule = string | RegExp;
export type Ignore = IgnoreRule[] | ((path: string) => boolean);

export function isIgnored(path: string, ignore: Ignore | undefined): boolean {
  if (!ignore) return false;
  if (typeof ignore === 'function') return !!ignore(path);
  for (const rule of ignore) {
    if (typeof rule === 'string') {
      if (path === rule || path.startsWith(rule.endsWith('/') ? rule : rule + '/')) return true;
    } else if (rule.test(path)) {
      return true;
    }
  }
  return false;
}

/** "/logo.png", "/app.js", "/robots.txt": assets, not pages. "/page.html" still counts. */
export function isAssetPath(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1);
  const match = /\.([a-z0-9]{1,8})$/i.exec(last);
  return !!match && !/^html?$/i.test(match[1]!);
}

/**
 * Speculative loads the browser or the framework makes without the user seeing the page:
 * `Purpose: prefetch`, `Sec-Purpose: prefetch;prerender`, `X-Purpose: preview`, `X-Moz: prefetch`,
 * Next.js `Next-Router-Prefetch` and React Server Component fetches (`RSC: 1`).
 */
export function isPrefetch(get: (name: string) => string | null | undefined): boolean {
  if (get('next-router-prefetch')) return true;
  if (get('rsc') === '1') return true;
  for (const name of ['purpose', 'sec-purpose', 'x-purpose', 'x-moz']) {
    const value = get(name)?.toLowerCase();
    if (value && (value.includes('prefetch') || value.includes('preview') || value.includes('prerender'))) return true;
  }
  return false;
}

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
export function isPageview(request: FetchRequestLike, response?: ResponseLike | null, options: IsPageviewOptions = {}): boolean {
  const get = (name: string) => {
    try {
      return request.headers.get(name);
    } catch {
      return null;
    }
  };
  if ((request.method ?? 'GET').toUpperCase() !== 'GET') return false;
  if (!(get('accept') ?? '').includes('text/html')) return false;
  if (isPrefetch(get)) return false;
  const path = pathOf(request.url);
  if (isAssetPath(path) || isIgnored(path, options.ignore)) return false;
  if (response) {
    if ((response.status ?? 200) !== 200) return false;
    const type = response.headers?.get('content-type');
    if (type && !type.includes('text/html')) return false;
  }
  return true;
}
