"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = exports.DEFAULT_URL = exports.VERSION = void 0;
exports.getDefaultClient = getDefaultClient;
exports.setDefaultClient = setDefaultClient;
// The client: builds events, queues them in memory and sends them in batches to POST /api/v1/events.
// Edge-safe: no node: imports; Node-only APIs (process.on, timer.unref) are reached through guards.
// It never throws into the app and never blocks a request.
const context_js_1 = require("./context.js");
const util_js_1 = require("./util.js");
exports.VERSION = '0.1.0';
exports.DEFAULT_URL = 'https://runomine.com';
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
class Client {
    /** False when there is no token or RUNOMINE_ENABLED is false: every call is a no-op. */
    enabled;
    endpoint;
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
        this.token = options.token ?? (0, util_js_1.env)('RUNOMINE_TOKEN') ?? '';
        const base = (options.url ?? (0, util_js_1.env)('RUNOMINE_URL') ?? exports.DEFAULT_URL).replace(/\/+$/, '');
        this.endpoint = base + '/api/v1/events';
        const enabled = options.enabled ?? (0, util_js_1.parseBool)((0, util_js_1.env)('RUNOMINE_ENABLED')) ?? true;
        this.enabled = enabled && this.token !== '';
        this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
        this.flushInterval = Math.max(0, options.flushInterval ?? 2000);
        this.batchSize = Math.min(500, Math.max(1, options.batchSize ?? 500));
        this.maxQueue = Math.max(this.batchSize, options.maxQueue ?? 10000);
        this.retryDelays = options.retryDelays ?? [1000, 3000];
        this.timeout = options.timeout ?? 5000;
        const debug = options.debug ?? (0, util_js_1.parseBool)((0, util_js_1.env)('RUNOMINE_DEBUG')) ?? false;
        this.log =
            typeof debug === 'function'
                ? debug
                : debug
                    ? (message, error) => console.warn('[runomine] ' + message, error ?? '')
                    : () => { };
    }
    /**
     * Records a pageview. Pass a RequestContext (`{ url, ip, userAgent, … }`), a Fetch Request or a
     * Node/Express request. Returns immediately; the event is sent with the next batch.
     */
    pageview(input) {
        if (!this.enabled)
            return;
        const id = (0, util_js_1.uuidv7)(this.platform.random);
        const now = new Date().toISOString();
        this.add(() => (0, util_js_1.then)(input, (source) => {
            const ctx = (0, context_js_1.resolveContext)(source);
            if (!ctx.url) {
                this.log('pageview without a url, dropped');
                return null;
            }
            const ts = ctx.ts !== undefined ? isoTs(ctx.ts) : now;
            return (0, util_js_1.then)(ctx.visitor || this.hashContext(ctx, ctx.url, ts), (visitor) => compact({
                id,
                type: 'pageview',
                ts,
                url: ctx.url,
                referrer: str(ctx.referrer),
                user_agent: str(ctx.userAgent) ?? '',
                visitor,
                country: str(ctx.country),
                user: str(ctx.user),
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
        const id = (0, util_js_1.uuidv7)(this.platform.random);
        const ts = isoTs(options.ts);
        this.add(() => (0, util_js_1.then)(options.request, (source) => {
            const ctx = (0, context_js_1.resolveContext)(source);
            const url = str(options.url) ?? str(ctx.url);
            // No request, no visitor: never a placeholder hash (contract, API v1 `visitor`).
            const visitor = options.visitor || (source ? this.hashContext(ctx, url, ts) : undefined);
            return (0, util_js_1.then)(visitor, (visitor) => compact({
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
                props: props && typeof props === 'object' && Object.keys(props).length ? { ...props } : undefined,
            }));
        }));
    }
    /** Sends everything queued. Resolves when done (or given up on); never rejects. */
    flush() {
        if (!this.enabled)
            return Promise.resolve();
        this.clearTimer();
        const run = async () => {
            while (this.pending.size)
                await Promise.allSettled([...this.pending]);
            while (this.queue.length)
                await this.send(this.queue.splice(0, this.batchSize));
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
            const ctx = (0, context_js_1.resolveContext)(request);
            return this.hashContext(ctx, str(ctx.url), (0, util_js_1.utcDay)(day));
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
            ctx = (0, context_js_1.resolveContext)(request);
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
            const visitor = this.hashContext(ctx, str(ctx.url), (0, util_js_1.utcDay)(options.day));
            return (0, util_js_1.isPromise)(visitor) ? visitor.then(withUser, () => withUser(undefined)) : withUser(visitor);
        }
        catch {
            return withUser(undefined);
        }
    }
    hashContext(ctx, url, ts) {
        const host = (0, util_js_1.normalizeHost)(ctx.host) || (0, util_js_1.hostOf)(url);
        return this.platform.hash(this.token, ctx.ip ? String(ctx.ip) : '', ctx.userAgent ? String(ctx.userAgent) : '', host, (0, util_js_1.utcDay)(ts));
    }
    add(build) {
        if (this.closed)
            return;
        try {
            const result = build();
            if ((0, util_js_1.isPromise)(result)) {
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
    async send(batch) {
        if (!this.fetchImpl) {
            this.log('no fetch available, batch dropped');
            return;
        }
        const body = JSON.stringify({ events: batch });
        for (let attempt = 0;; attempt++) {
            let status = 0;
            let retryAfter;
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
                            const parsed = JSON.parse(text);
                            if (parsed.rejected?.length)
                                this.log(`${parsed.rejected.length} event(s) rejected`, parsed.rejected);
                        }
                        catch {
                            // not JSON
                        }
                    }
                    return;
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
                this.log(`batch of ${batch.length} dropped (status ${status || 'network error'})`);
                return;
            }
            await sleep(retryAfter ?? this.retryDelays[attempt]);
        }
    }
}
exports.Client = Client;
// ---- default clients (shared by the ESM and CJS builds; one per platform, so the Node entry's
// default client always hashes synchronously) ----------------------------------------------------
const defaultKey = (platform) => Symbol.for('runomine.defaultClient.' + platform.name);
function getDefaultClient(platform) {
    const g = globalThis;
    return (g[defaultKey(platform)] ??= new Client({}, platform));
}
/** Replaces the default client, e.g. to configure it in code instead of the environment. */
function setDefaultClient(platform, client) {
    globalThis[defaultKey(platform)] = client;
}
