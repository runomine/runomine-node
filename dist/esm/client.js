// The client: builds events, queues them in memory and sends them in batches to POST /api/v1/events.
// Edge-safe: no node: imports; Node-only APIs (process.on, timer.unref) are reached through guards.
// It never throws into the app and never blocks a request.
import { resolveContext } from './context.js';
import { env, hostOf, isPromise, normalizeHost, parseBool, then, utcDay, uuidv7, } from './util.js';
export const VERSION = '0.2.0';
export const DEFAULT_URL = 'https://runomine.com';
// ---- process hooks (Node only, guarded) ------------------------------------------------------
const dirty = new Set();
let exitHooked = false;
function hookBeforeExit() {
    if (exitHooked)
        return;
    const proc = globalThis.process;
    if (!proc || typeof proc.on !== 'function')
        return;
    exitHooked = true;
    try {
        // beforeExit fires when the loop empties; flushing schedules work, so it fires again
        // afterwards and the process exits once no client has anything left.
        proc.on('beforeExit', () => {
            for (const client of dirty)
                if (client.hasWork())
                    void client.flush();
        });
    }
    catch {
        // not a real Node process
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function timeoutSignal(ms) {
    const AS = globalThis.AbortSignal;
    return ms > 0 && AS && typeof AS.timeout === 'function' ? AS.timeout(ms) : undefined;
}
function isoTs(ts) {
    if (ts === undefined)
        return new Date().toISOString();
    const d = ts instanceof Date ? ts : new Date(ts);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function propsOf(props) {
    return props && typeof props === 'object' && Object.keys(props).length ? { ...props } : undefined;
}
function str(value) {
    if (value === null || value === undefined || value === '')
        return undefined;
    return String(value);
}
/** Drops undefined/null/empty fields so the payload only carries what is known. */
function compact(event) {
    for (const key of Object.keys(event)) {
        const v = event[key];
        if (v === undefined || v === null || v === '')
            delete event[key];
    }
    return event;
}
// ---- client -----------------------------------------------------------------------------------
export class Client {
    /** False when there is no token or RUNOMINE_ENABLED is false: every call is a no-op. */
    enabled;
    endpoint;
    samplesEndpoint;
    token;
    platform;
    fetchImpl;
    flushInterval;
    batchSize;
    maxQueue;
    retryDelays;
    timeout;
    log;
    queue = [];
    pending = new Set();
    chain = Promise.resolve();
    timer = null;
    closed = false;
    constructor(options = {}, platform) {
        this.platform = platform;
        this.token = options.token ?? env('RUNOMINE_TOKEN') ?? '';
        const base = (options.url ?? env('RUNOMINE_URL') ?? DEFAULT_URL).replace(/\/+$/, '');
        this.endpoint = base + '/api/v1/events';
        this.samplesEndpoint = base + '/api/v1/samples';
        const enabled = options.enabled ?? parseBool(env('RUNOMINE_ENABLED')) ?? true;
        this.enabled = enabled && this.token !== '';
        this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
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
                    : () => { };
    }
    /**
     * Records a pageview. Pass a RequestContext (`{ url, ip, userAgent, … }`), a Fetch Request or a
     * Node/Express request, and optionally props: `pageview(req, { props: { section: 'news' } })`.
     * Returns immediately; the event is sent with the next batch.
     */
    pageview(input, options) {
        if (!this.enabled)
            return;
        const given = options?.props;
        const id = uuidv7(this.platform.random);
        const now = new Date().toISOString();
        this.add(() => then(input, (source) => {
            const ctx = resolveContext(source);
            if (!ctx.url) {
                this.log('pageview without a url, dropped');
                return null;
            }
            const ts = ctx.ts !== undefined ? isoTs(ctx.ts) : now;
            return then(ctx.visitor || this.hashContext(ctx, ctx.url, ts), (visitor) => compact({
                id,
                type: 'pageview',
                ts,
                url: ctx.url,
                referrer: str(ctx.referrer),
                user_agent: str(ctx.userAgent) ?? '',
                visitor,
                country: str(ctx.country),
                user: str(ctx.user),
                props: propsOf(given ?? ctx.props),
            }));
        }));
    }
    /**
     * Records a business event: `track('signup')`, `track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: 42, request: req })`.
     * Returns immediately; never throws.
     */
    track(name, props, trackOptions) {
        if (!this.enabled)
            return;
        const options = trackOptions ?? {};
        const id = uuidv7(this.platform.random);
        const ts = isoTs(options.ts);
        this.add(() => then(options.request, (source) => {
            const ctx = resolveContext(source);
            const url = str(options.url) ?? str(ctx.url);
            // No request, no visitor: never a placeholder hash (contract, API v1 `visitor`).
            const visitor = options.visitor || (source ? this.hashContext(ctx, url, ts) : undefined);
            return then(visitor, (visitor) => compact({
                id,
                type: 'event',
                name: String(name),
                ts,
                url,
                user_agent: str(ctx.userAgent),
                visitor,
                country: str(ctx.country),
                user: str(options.user ?? ctx.user),
                revenue: options.revenue && options.revenue.currency
                    ? { amount: Number(options.revenue.amount), currency: String(options.revenue.currency) }
                    : undefined,
                props: propsOf(props),
            }));
        }));
    }
    /**
     * Sends one sample of the app's own ops numbers (queue depth, CPU, people on the site right now) to
     * POST /api/v1/samples, for runomine's Live page: `await client.sample({ queue: { pending: 3 }, healthy: true })`.
     * Sent at once, not queued, with the same retries as events; one sample per second (the same `ts` again
     * replaces it). Resolves true when runomine took it, false when disabled or it failed. Never rejects.
     */
    sample(data, ts) {
        return this.samples([{ data, ts }]);
    }
    /** Several samples (a catch-up after an outage), in calls of at most 500. True when every call was taken. */
    async samples(samples) {
        if (!this.enabled || this.closed)
            return false;
        try {
            const rows = [];
            for (const sample of samples) {
                if (!sample || typeof sample.data !== 'object' || sample.data === null || Array.isArray(sample.data))
                    continue;
                rows.push({ ts: isoTs(sample.ts), data: sample.data });
            }
            let ok = true;
            for (let i = 0; i < rows.length; i += 500) {
                const chunk = rows.slice(i, i + 500);
                ok = (await this.post(this.samplesEndpoint, JSON.stringify({ samples: chunk }), chunk.length, 'sample')) && ok;
            }
            return ok;
        }
        catch (error) {
            this.log('could not send the samples', error);
            return false;
        }
    }
    /** Sends everything queued. Resolves when done (or given up on); never rejects. */
    flush() {
        if (!this.enabled)
            return Promise.resolve();
        this.clearTimer();
        const run = async () => {
            while (this.pending.size)
                await Promise.allSettled([...this.pending]);
            while (this.queue.length) {
                const batch = this.queue.splice(0, this.batchSize);
                await this.post(this.endpoint, JSON.stringify({ events: batch }), batch.length, 'event');
            }
            if (!this.hasWork())
                dirty.delete(this);
        };
        const next = this.chain.then(run).catch((error) => this.log('flush failed', error));
        this.chain = next;
        return next;
    }
    /** Flushes and stops: later calls are ignored. Call it before `process.exit()`, which skips `beforeExit`. */
    async shutdown() {
        if (this.closed)
            return;
        await this.flush();
        this.closed = true;
        this.clearTimer();
        dirty.delete(this);
    }
    /** True while events are queued or being prepared. */
    hasWork() {
        return this.queue.length > 0 || this.pending.size > 0;
    }
    /** Number of events waiting to be sent. */
    get size() {
        return this.queue.length;
    }
    // ---- internals ----
    /**
     * The visitor hash for a request, with this client's token: `undefined` without a request or a token.
     * Synchronous with the Node entry, a promise with the Next.js/Edge entry.
     */
    visitorFor(request, day) {
        try {
            if (!request || !this.token)
                return undefined;
            const ctx = resolveContext(request);
            return this.hashContext(ctx, str(ctx.url), utcDay(day));
        }
        catch {
            return undefined;
        }
    }
    /**
     * What to pass to your payment provider when creating a checkout (Stripe `metadata`, Paddle `customData`, …),
     * so runomine can attribute the sale: `runomine_visitor` (the request's visitor hash) and `runomine_user`
     * (`options.user`, else the request context's user). Only keys with a value: no visitor when the client is
     * disabled or the request has no IP. Synchronous with the Node entry, a promise with the Next.js/Edge entry.
     */
    checkoutMetadata(request, options = {}) {
        const metadata = {};
        let ctx = {};
        try {
            ctx = resolveContext(request);
        }
        catch {
            // no request facts: no visitor
        }
        const user = str(options.user ?? undefined) ?? str(ctx.user ?? undefined);
        const withUser = (visitor) => {
            if (visitor)
                metadata.runomine_visitor = visitor;
            if (user)
                metadata.runomine_user = user;
            return metadata;
        };
        try {
            if (!this.enabled || !ctx.ip)
                return withUser(undefined);
            const visitor = this.hashContext(ctx, str(ctx.url), utcDay(options.day));
            return isPromise(visitor) ? visitor.then(withUser, () => withUser(undefined)) : withUser(visitor);
        }
        catch {
            return withUser(undefined);
        }
    }
    hashContext(ctx, url, ts) {
        const host = normalizeHost(ctx.host) || hostOf(url);
        return this.platform.hash(this.token, ctx.ip ? String(ctx.ip) : '', ctx.userAgent ? String(ctx.userAgent) : '', host, utcDay(ts));
    }
    add(build) {
        if (this.closed)
            return;
        try {
            const result = build();
            if (isPromise(result)) {
                const p = result
                    .then((event) => {
                    if (event)
                        this.push(event);
                }, (error) => this.log('could not build the event, dropped', error))
                    .finally(() => this.pending.delete(p));
                this.pending.add(p);
                this.markDirty();
            }
            else if (result) {
                this.push(result);
            }
        }
        catch (error) {
            this.log('could not build the event, dropped', error);
        }
    }
    push(event) {
        this.queue.push(event);
        if (this.queue.length > this.maxQueue) {
            this.queue.splice(0, this.queue.length - this.maxQueue);
            this.log('queue full, oldest events dropped');
        }
        this.markDirty();
        if (this.queue.length >= this.batchSize)
            void this.flush();
    }
    markDirty() {
        dirty.add(this);
        hookBeforeExit();
        if (this.timer || this.closed)
            return;
        try {
            const t = setTimeout(() => {
                this.timer = null;
                void this.flush();
            }, this.flushInterval);
            if (typeof t?.unref === 'function')
                t.unref();
            this.timer = t;
        }
        catch {
            // no timers: flush() is still called by waitUntil / beforeExit / the app
        }
    }
    clearTimer() {
        if (!this.timer)
            return;
        try {
            clearTimeout(this.timer);
        }
        catch {
            // ignore
        }
        this.timer = null;
    }
    /** One POST with retries. True on a 2xx; false once dropped. Never rejects. */
    async post(url, body, count, kind) {
        if (!this.fetchImpl) {
            this.log('no fetch available, batch dropped');
            return false;
        }
        for (let attempt = 0;; attempt++) {
            let status = 0;
            let retryAfter;
            try {
                const res = await this.fetchImpl(url, {
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
                            const parsed = JSON.parse(text);
                            if (parsed.rejected?.length)
                                this.log(`${parsed.rejected.length} ${kind}(s) rejected`, parsed.rejected);
                        }
                        catch {
                            // not JSON
                        }
                    }
                    return true;
                }
                const header = res.headers?.get?.('retry-after');
                if (header && /^\d+$/.test(header.trim()))
                    retryAfter = Math.min(Number(header) * 1000, 10000);
            }
            catch (error) {
                status = 0;
                this.log('request failed', error);
            }
            const retryable = status === 0 || status === 429 || status >= 500;
            if (!retryable || attempt >= this.retryDelays.length) {
                this.log(`batch of ${count} ${kind}(s) dropped (status ${status || 'network error'})`);
                return false;
            }
            await sleep(retryAfter ?? this.retryDelays[attempt]);
        }
    }
}
// ---- default clients (shared by the ESM and CJS builds; one per platform, so the Node entry's
// default client always hashes synchronously) ----------------------------------------------------
const defaultKey = (platform) => Symbol.for('runomine.defaultClient.' + platform.name);
export function getDefaultClient(platform) {
    const g = globalThis;
    return (g[defaultKey(platform)] ??= new Client({}, platform));
}
/** Replaces the default client, e.g. to configure it in code instead of the environment. */
export function setDefaultClient(platform, client) {
    globalThis[defaultKey(platform)] = client;
}
