import { type RequestContext, type RequestSource } from './context.js';
import { type MaybePromise, type RandomBytes } from './util.js';
export declare const VERSION = "0.1.0";
export declare const DEFAULT_URL = "https://runomine.com";
export interface Revenue {
    /** Amount in major units: 4.99, not 499. */
    amount: number;
    /** ISO 4217, e.g. "EUR". */
    currency: string;
}
/** Flat, up to 20 keys, string or number values. */
export type Props = Record<string, string | number>;
/** The event as sent to runomine (API v1). */
export interface WireEvent {
    id: string;
    type: 'pageview' | 'event';
    name?: string;
    ts: string;
    url?: string;
    referrer?: string;
    user_agent?: string;
    /** Required for pageviews; left out of events that have no web request behind them. */
    visitor?: string;
    country?: string;
    user?: string;
    revenue?: Revenue;
    props?: Props;
}
export interface FetchResponseLike {
    status: number;
    headers?: {
        get(name: string): string | null;
    };
    text?(): Promise<string>;
}
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: unknown;
}) => Promise<FetchResponseLike>;
export interface ClientOptions {
    /** Server token, `rm_live_…`. Default: RUNOMINE_TOKEN. */
    token?: string;
    /** Default: RUNOMINE_URL, else https://runomine.com. */
    url?: string;
    /** Default: RUNOMINE_ENABLED, else true when there is a token. Without a token the client is always off. */
    enabled?: boolean;
    /** Milliseconds between automatic flushes. Default 2000. */
    flushInterval?: number;
    /** Events per POST, at most 500. Default 500. */
    batchSize?: number;
    /** Events kept in memory while runomine is unreachable; the oldest are dropped beyond it. Default 10000. */
    maxQueue?: number;
    /** Waits before each retry on 5xx, 429 or a network error. Default [1000, 3000]: two retries. */
    retryDelays?: number[];
    /** Per-request timeout in milliseconds. Default 5000. */
    timeout?: number;
    /** Default: the global fetch. */
    fetch?: FetchLike;
    /** Log dropped batches and bad input with console.warn, or pass your own logger. Default: RUNOMINE_DEBUG. */
    debug?: boolean | ((message: string, error?: unknown) => void);
}
export interface PageviewInput extends RequestContext {
    /** Precomputed visitor hash; computed from ip, userAgent and host otherwise. */
    visitor?: string;
    /** Event time. Default: now. */
    ts?: Date | string | number;
}
export interface TrackOptions {
    revenue?: Revenue | null;
    /** Your own user id. Overrides the one from `request`. */
    user?: string | number | null;
    /**
     * The request the event belongs to, for the visitor hash, URL and country: a Fetch Request, `{ headers }`,
     * a Node/Express request or a RequestContext. Without it (webhooks, jobs, scripts) the event carries no
     * `visitor` and runomine attributes it through `user`.
     */
    request?: MaybePromise<RequestSource | null | undefined>;
    /** Overrides the URL taken from `request`. */
    url?: string | null;
    /**
     * A visitor hash captured earlier with `visitorFor(req)`, e.g. stored with the order at checkout and used
     * in the payment webhook. Takes precedence over `request`.
     */
    visitor?: string | null;
    ts?: Date | string | number;
}
/**
 * Identifiers for your payment provider's checkout: `runomine_visitor` and `runomine_user`, each only when it has
 * a value. A plain string map, so it fits Stripe `metadata`, Paddle `customData` or `new URLSearchParams(…)`.
 */
export type CheckoutMetadata = Record<string, string>;
export interface CheckoutMetadataOptions {
    /** Your own user id. Default: the request context's `user`, if any. */
    user?: string | number | null;
    /** The UTC day of the hash (default today). For tests. */
    day?: string | Date | number;
}
/** How a runtime hashes and draws random bytes (node:crypto on Node, Web Crypto on the Edge). */
export interface Platform {
    /** "node" (sync node:crypto) or "web" (async Web Crypto). Each has its own default client. */
    name: 'node' | 'web';
    hash(token: string, ip: string, userAgent: string, host: string, day: string): MaybePromise<string>;
    random: RandomBytes;
}
export declare class Client {
    /** False when there is no token or RUNOMINE_ENABLED is false: every call is a no-op. */
    readonly enabled: boolean;
    readonly endpoint: string;
    private readonly token;
    private readonly platform;
    private readonly fetchImpl;
    private readonly flushInterval;
    private readonly batchSize;
    private readonly maxQueue;
    private readonly retryDelays;
    private readonly timeout;
    private readonly log;
    private queue;
    private pending;
    private chain;
    private timer;
    private closed;
    constructor(options: ClientOptions | undefined, platform: Platform);
    /**
     * Records a pageview. Pass a RequestContext (`{ url, ip, userAgent, … }`), a Fetch Request or a
     * Node/Express request. Returns immediately; the event is sent with the next batch.
     */
    pageview(input: MaybePromise<PageviewInput | RequestSource | null | undefined>): void;
    /**
     * Records a business event: `track('signup')`, `track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: 42, request: req })`.
     * Returns immediately; never throws.
     */
    track(name: string, props?: Props | null, trackOptions?: TrackOptions | null): void;
    /** Sends everything queued. Resolves when done (or given up on); never rejects. */
    flush(): Promise<void>;
    /** Flushes and stops: later calls are ignored. Call it before `process.exit()`, which skips `beforeExit`. */
    shutdown(): Promise<void>;
    /** True while events are queued or being prepared. */
    hasWork(): boolean;
    /** Number of events waiting to be sent. */
    get size(): number;
    /**
     * The visitor hash for a request, with this client's token: `undefined` without a request or a token.
     * Synchronous with the Node entry, a promise with the Next.js/Edge entry.
     */
    visitorFor(request: RequestSource | null | undefined, day?: string | Date | number): MaybePromise<string | undefined>;
    /**
     * What to pass to your payment provider when creating a checkout (Stripe `metadata`, Paddle `customData`, …),
     * so runomine can attribute the sale: `runomine_visitor` (the request's visitor hash) and `runomine_user`
     * (`options.user`, else the request context's user). Only keys with a value: no visitor when the client is
     * disabled or the request has no IP. Synchronous with the Node entry, a promise with the Next.js/Edge entry.
     */
    checkoutMetadata(request: RequestSource | null | undefined, options?: CheckoutMetadataOptions): MaybePromise<CheckoutMetadata>;
    private hashContext;
    private add;
    private push;
    private markDirty;
    private clearTimer;
    private send;
}
export declare function getDefaultClient(platform: Platform): Client;
/** Replaces the default client, e.g. to configure it in code instead of the environment. */
export declare function setDefaultClient(platform: Platform, client: Client | undefined): void;
