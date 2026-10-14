// The client: builds events, queues them in memory and sends them in batches to POST /api/v1/events.
// Edge-safe: no node: imports; Node-only APIs (process.on, timer.unref) are reached through guards.
// It never throws into the app and never blocks a request.
import { resolveContext, type RequestContext, type RequestSource } from './context.js';
import {
  env,
  hostOf,
  isPromise,
  normalizeHost,
  parseBool,
  then,
  utcDay,
  uuidv7,
  type MaybePromise,
  type RandomBytes,
} from './util.js';

export const VERSION = '0.1.0';
export const DEFAULT_URL = 'https://runomine.com';

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
  headers?: { get(name: string): string | null };
  text?(): Promise<string>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: unknown }) => Promise<FetchResponseLike>;

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

// ---- process hooks (Node only, guarded) ------------------------------------------------------

const dirty = new Set<Client>();
let exitHooked = false;

function hookBeforeExit(): void {
  if (exitHooked) return;
  const proc = (globalThis as { process?: { on?: (event: string, fn: () => void) => unknown } }).process;
  if (!proc || typeof proc.on !== 'function') return;
  exitHooked = true;
  try {
    // beforeExit fires when the loop empties; flushing schedules work, so it fires again
    // afterwards and the process exits once no client has anything left.
    proc.on('beforeExit', () => {
      for (const client of dirty) if (client.hasWork()) void client.flush();
    });
  } catch {
    // not a real Node process
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function timeoutSignal(ms: number): unknown {
  const AS = (globalThis as { AbortSignal?: { timeout?: (ms: number) => unknown } }).AbortSignal;
  return ms > 0 && AS && typeof AS.timeout === 'function' ? AS.timeout(ms) : undefined;
}

function isoTs(ts: Date | string | number | undefined): string {
  if (ts === undefined) return new Date().toISOString();
  const d = ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function str(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value);
}

/** Drops undefined/null/empty fields so the payload only carries what is known. */
function compact(event: WireEvent): WireEvent {
  for (const key of Object.keys(event) as (keyof WireEvent)[]) {
    const v = event[key];
    if (v === undefined || v === null || v === '') delete event[key];
  }
  return event;
}

// ---- client -----------------------------------------------------------------------------------

export class Client {
  /** False when there is no token or RUNOMINE_ENABLED is false: every call is a no-op. */
  readonly enabled: boolean;
  readonly endpoint: string;
  private readonly token: string;
  private readonly platform: Platform;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly flushInterval: number;
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly retryDelays: number[];
  private readonly timeout: number;
  private readonly log: (message: string, error?: unknown) => void;
  private queue: WireEvent[] = [];
  private pending = new Set<Promise<void>>();
  private chain: Promise<void> = Promise.resolve();
  private timer: unknown = null;
  private closed = false;

  constructor(options: ClientOptions = {}, platform: Platform) {
    this.platform = platform;
    this.token = options.token ?? env('RUNOMINE_TOKEN') ?? '';
    const base = (options.url ?? env('RUNOMINE_URL') ?? DEFAULT_URL).replace(/\/+$/, '');
    this.endpoint = base + '/api/v1/events';
    const enabled = options.enabled ?? parseBool(env('RUNOMINE_ENABLED')) ?? true;
    this.enabled = enabled && this.token !== '';
    this.fetchImpl = options.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch?.bind(globalThis) as FetchLike | undefined);
    this.flushInterval = Math.max(0, options.flushInterval ?? 2000);
    this.batchSize = Math.min(500, Math.max(1, options.batchSize ?? 500));
    this.maxQueue = Math.max(this.batchSize, options.maxQueue ?? 10000);
    this.retryDelays = options.retryDelays ?? [1000, 3000];
    this.timeout = options.timeout ?? 5000;
    const debug = options.debug ?? parseBool(env('RUNOMINE_DEBUG')) ?? false;
    this.log =
      typeof debug === 'function'
        ? debug
        : debug
          ? (message, error) => console.warn('[runomine] ' + message, error ?? '')
          : () => {};
  }

  /**
   * Records a pageview. Pass a RequestContext (`{ url, ip, userAgent, … }`), a Fetch Request or a
   * Node/Express request. Returns immediately; the event is sent with the next batch.
   */
  pageview(input: MaybePromise<PageviewInput | RequestSource | null | undefined>): void {
    if (!this.enabled) return;
    const id = uuidv7(this.platform.random);
    const now = new Date().toISOString();
    this.add(() =>
      then(input, (source) => {
        const ctx = resolveContext(source) as PageviewInput;
        if (!ctx.url) {
          this.log('pageview without a url, dropped');
          return null;
        }
        const ts = ctx.ts !== undefined ? isoTs(ctx.ts) : now;
        return then(ctx.visitor || this.hashContext(ctx, ctx.url, ts), (visitor) =>
          compact({
            id,
            type: 'pageview',
            ts,
            url: ctx.url!,
            referrer: str(ctx.referrer),
            user_agent: str(ctx.userAgent) ?? '',
            visitor,
            country: str(ctx.country),
            user: str(ctx.user),
          }),
        );
      }),
    );
  }

  /**
   * Records a business event: `track('signup')`, `track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: 42, request: req })`.
   * Returns immediately; never throws.
   */
  track(name: string, props?: Props | null, trackOptions?: TrackOptions | null): void {
    if (!this.enabled) return;
    const options = trackOptions ?? {};
    const id = uuidv7(this.platform.random);
    const ts = isoTs(options.ts);
    this.add(() =>
      then(options.request, (source) => {
        const ctx = resolveContext(source);
        const url = str(options.url) ?? str(ctx.url);
        // No request, no visitor: never a placeholder hash (contract, API v1 `visitor`).
        const visitor = options.visitor || (source ? this.hashContext(ctx, url, ts) : undefined);
        return then(visitor, (visitor) =>
          compact({
            id,
            type: 'event',
            name: String(name),
            ts,
            url,
            user_agent: str(ctx.userAgent),
            visitor,
            country: str(ctx.country),
            user: str(options.user ?? ctx.user),
            revenue:
              options.revenue && options.revenue.currency
                ? { amount: Number(options.revenue.amount), currency: String(options.revenue.currency) }
                : undefined,
            props: props && typeof props === 'object' && Object.keys(props).length ? { ...props } : undefined,
          }),
        );
      }),
    );
  }

  /** Sends everything queued. Resolves when done (or given up on); never rejects. */
  flush(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.clearTimer();
    const run = async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      while (this.queue.length) await this.send(this.queue.splice(0, this.batchSize));
      if (!this.hasWork()) dirty.delete(this);
    };
    const next = this.chain.then(run).catch((error) => this.log('flush failed', error));
    this.chain = next;
    return next;
  }

  /** Flushes and stops: later calls are ignored. Call it before `process.exit()`, which skips `beforeExit`. */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    this.clearTimer();
    dirty.delete(this);
  }

  /** True while events are queued or being prepared. */
  hasWork(): boolean {
    return this.queue.length > 0 || this.pending.size > 0;
  }

  /** Number of events waiting to be sent. */
  get size(): number {
    return this.queue.length;
  }

  // ---- internals ----

  /**
   * The visitor hash for a request, with this client's token: `undefined` without a request or a token.
   * Synchronous with the Node entry, a promise with the Next.js/Edge entry.
   */
  visitorFor(request: RequestSource | null | undefined, day?: string | Date | number): MaybePromise<string | undefined> {
    try {
      if (!request || !this.token) return undefined;
      const ctx = resolveContext(request);
      return this.hashContext(ctx, str(ctx.url), utcDay(day));
    } catch {
      return undefined;
    }
  }

  /**
   * What to pass to your payment provider when creating a checkout (Stripe `metadata`, Paddle `customData`, …),
   * so runomine can attribute the sale: `runomine_visitor` (the request's visitor hash) and `runomine_user`
   * (`options.user`, else the request context's user). Only keys with a value: no visitor when the client is
   * disabled or the request has no IP. Synchronous with the Node entry, a promise with the Next.js/Edge entry.
   */
  checkoutMetadata(request: RequestSource | null | undefined, options: CheckoutMetadataOptions = {}): MaybePromise<CheckoutMetadata> {
    const metadata: CheckoutMetadata = {};
    let ctx: RequestContext = {};
    try {
      ctx = resolveContext(request);
    } catch {
      // no request facts: no visitor
    }
    const user = str(options.user ?? undefined) ?? str(ctx.user ?? undefined);
    const withUser = (visitor: string | undefined): CheckoutMetadata => {
      if (visitor) metadata.runomine_visitor = visitor;
      if (user) metadata.runomine_user = user;
      return metadata;
    };
    try {
      if (!this.enabled || !ctx.ip) return withUser(undefined);
      const visitor = this.hashContext(ctx, str(ctx.url), utcDay(options.day));
      return isPromise<string>(visitor) ? visitor.then(withUser, () => withUser(undefined)) : withUser(visitor);
    } catch {
      return withUser(undefined);
    }
  }

  private hashContext(ctx: RequestContext, url: string | undefined, ts: string): MaybePromise<string> {
    const host = normalizeHost(ctx.host) || hostOf(url);
    return this.platform.hash(this.token, ctx.ip ? String(ctx.ip) : '', ctx.userAgent ? String(ctx.userAgent) : '', host, utcDay(ts));
  }

  private add(build: () => MaybePromise<WireEvent | null>): void {
    if (this.closed) return;
    try {
      const result = build();
      if (isPromise<WireEvent | null>(result)) {
        const p: Promise<void> = result
          .then(
            (event) => {
              if (event) this.push(event);
            },
            (error) => this.log('could not build the event, dropped', error),
          )
          .finally(() => this.pending.delete(p));
        this.pending.add(p);
        this.markDirty();
      } else if (result) {
        this.push(result);
      }
    } catch (error) {
      this.log('could not build the event, dropped', error);
    }
  }

  private push(event: WireEvent): void {
    this.queue.push(event);
    if (this.queue.length > this.maxQueue) {
      this.queue.splice(0, this.queue.length - this.maxQueue);
      this.log('queue full, oldest events dropped');
    }
    this.markDirty();
    if (this.queue.length >= this.batchSize) void this.flush();
  }

  private markDirty(): void {
    dirty.add(this);
    hookBeforeExit();
    if (this.timer || this.closed) return;
    try {
      const t = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.flushInterval) as unknown as { unref?: () => void };
      if (typeof t?.unref === 'function') t.unref();
      this.timer = t;
    } catch {
      // no timers: flush() is still called by waitUntil / beforeExit / the app
    }
  }

  private clearTimer(): void {
    if (!this.timer) return;
    try {
      clearTimeout(this.timer as Parameters<typeof clearTimeout>[0]);
    } catch {
      // ignore
    }
    this.timer = null;
  }

  private async send(batch: WireEvent[]): Promise<void> {
    if (!this.fetchImpl) {
      this.log('no fetch available, batch dropped');
      return;
    }
    const body = JSON.stringify({ events: batch });
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      let retryAfter: number | undefined;
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + this.token,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body,
          signal: timeoutSignal(this.timeout),
        });
        status = res.status;
        const text = await res.text?.().catch(() => '');
        if (status >= 200 && status < 300) {
          if (text && text.includes('"rejected"')) {
            try {
              const parsed = JSON.parse(text) as { rejected?: unknown[] };
              if (parsed.rejected?.length) this.log(`${parsed.rejected.length} event(s) rejected`, parsed.rejected);
            } catch {
              // not JSON
            }
          }
          return;
        }
        const header = res.headers?.get?.('retry-after');
        if (header && /^\d+$/.test(header.trim())) retryAfter = Math.min(Number(header) * 1000, 10000);
      } catch (error) {
        status = 0;
        this.log('request failed', error);
      }
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= this.retryDelays.length) {
        this.log(`batch of ${batch.length} dropped (status ${status || 'network error'})`);
        return;
      }
      await sleep(retryAfter ?? this.retryDelays[attempt]!);
    }
  }
}

// ---- default clients (shared by the ESM and CJS builds; one per platform, so the Node entry's
// default client always hashes synchronously) ----------------------------------------------------

const defaultKey = (platform: Platform) => Symbol.for('runomine.defaultClient.' + platform.name);

export function getDefaultClient(platform: Platform): Client {
  const g = globalThis as unknown as Record<symbol, Client | undefined>;
  return (g[defaultKey(platform)] ??= new Client({}, platform));
}

/** Replaces the default client, e.g. to configure it in code instead of the environment. */
export function setDefaultClient(platform: Platform, client: Client | undefined): void {
  (globalThis as unknown as Record<symbol, Client | undefined>)[defaultKey(platform)] = client;
}
