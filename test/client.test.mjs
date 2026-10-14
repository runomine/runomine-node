import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, uuidv7 } from '../dist/esm/index.js';
import { VECTOR as V, fakeFetch, fastRetry } from './helpers.mjs';

const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function client(fetch, extra = {}) {
  return createClient({ token: V.token, url: 'https://rm.test/', fetch, ...fastRetry, ...extra });
}

test('pageview payload shape, endpoint and headers', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  c.pageview({
    url: 'https://example.com/pricing?utm_source=newsletter',
    ip: V.ip,
    userAgent: V.userAgent,
    referrer: 'https://www.google.com/',
    country: 'ES',
    user: 42,
    ts: '2026-10-13T18:04:05.123Z',
  });
  await c.flush();
  assert.equal(fetch.calls.length, 1);
  const { url, init, body } = fetch.calls[0];
  assert.equal(url, 'https://rm.test/api/v1/events');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer ' + V.token);
  assert.equal(init.headers['content-type'], 'application/json');
  assert.equal(body.events.length, 1);
  const e = body.events[0];
  assert.match(e.id, UUID7);
  assert.deepEqual({ ...e, id: undefined }, {
    id: undefined,
    type: 'pageview',
    ts: '2026-10-13T18:04:05.123Z',
    url: 'https://example.com/pricing?utm_source=newsletter',
    referrer: 'https://www.google.com/',
    user_agent: V.userAgent,
    visitor: V.visitor, // same day as the vector
    country: 'ES',
    user: '42',
  });
  assert.ok(!JSON.stringify(body).includes(V.ip), 'the IP never leaves the server');
});

test('event payload shape with revenue, props and user', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  c.track('purchase', { plan: 'rent', film: 'the-third-man' }, {
    revenue: { amount: 4.99, currency: 'EUR' },
    user: 42,
    request: { url: 'https://example.com/checkout/success', ip: V.ip, userAgent: V.userAgent },
    ts: new Date('2026-10-13T18:06:00Z'),
  });
  c.track('signup');
  await c.flush();
  const [purchase, signup] = fetch.calls[0].body.events;
  assert.deepEqual({ ...purchase, id: undefined }, {
    id: undefined,
    type: 'event',
    name: 'purchase',
    ts: '2026-10-13T18:06:00.000Z',
    url: 'https://example.com/checkout/success',
    user_agent: V.userAgent,
    visitor: V.visitor,
    user: '42',
    revenue: { amount: 4.99, currency: 'EUR' },
    props: { plan: 'rent', film: 'the-third-man' },
  });
  assert.equal(signup.type, 'event');
  assert.equal(signup.name, 'signup');
  assert.ok(!('visitor' in signup), 'no request behind it: no visitor, never a placeholder');
  assert.equal(signup.props, undefined);
  assert.equal(signup.revenue, undefined);
  assert.notEqual(signup.id, purchase.id);
});

test('track takes the context from a Fetch Request and from a Node request', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  const ts = '2026-10-13T12:00:00Z';
  c.track('a', null, {
    ts,
    request: new Request('https://example.com/x', {
      headers: { 'user-agent': V.userAgent, 'x-forwarded-for': `${V.ip}, 10.0.0.1`, 'cf-ipcountry': 'fr' },
    }),
  });
  c.track('b', null, {
    ts,
    request: { method: 'POST', url: '/x', headers: { host: 'Example.com:3000', 'user-agent': V.userAgent }, socket: { remoteAddress: '::ffff:' + V.ip } },
  });
  await c.flush();
  const [a, b] = fetch.calls[0].body.events;
  assert.equal(a.visitor, V.visitor);
  assert.equal(a.country, 'FR');
  assert.equal(a.url, 'https://example.com/x');
  assert.equal(b.visitor, V.visitor);
  assert.equal(b.url, 'http://Example.com:3000/x');
});

test('events: visitor from request, explicit visitor, or none at all', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  const req = { url: 'https://example.com/checkout', ip: V.ip, userAgent: V.userAgent };
  // At checkout: capture the visitor and keep it with the order.
  const captured = c.visitorFor(req, V.day);
  assert.equal(captured, V.visitor);
  // Later, in the payment webhook: no request, the stored visitor.
  c.track('purchase', null, { visitor: captured, user: 42, revenue: { amount: 10, currency: 'EUR' } });
  // A job with no visitor at all.
  c.track('renewal', null, { user: 42, request: null });
  c.track('renewal_2', null, { user: 42, visitor: null });
  await c.flush();
  const byName = Object.fromEntries(fetch.calls[0].body.events.map((e) => [e.name, e]));
  assert.equal(byName.purchase.visitor, V.visitor);
  assert.ok(!('visitor' in byName.renewal));
  assert.ok(!('visitor' in byName.renewal_2));
  assert.equal(byName.renewal.user, '42');
  assert.equal(c.visitorFor(null), undefined);
  assert.equal(createClient({ token: '' }).visitorFor(req), undefined, 'no token: no hash');
});

test('default visitorFor() is synchronous and matches the vector', async () => {
  const { init, visitorFor } = await import('../dist/esm/index.js');
  init({ token: V.token, enabled: false });
  assert.equal(visitorFor({ url: 'https://Example.com:8080/x', ip: V.ip, userAgent: V.userAgent }, V.day), V.visitor);
  assert.equal(visitorFor(undefined), undefined);
  init({ token: '' });
});

test('checkoutMetadata: the vector from a context, an Express request and a Fetch Request', async () => {
  const { init, checkoutMetadata } = await import('../dist/esm/index.js');
  const c = createClient({ token: V.token, fetch: fakeFetch(), ...fastRetry });
  const ctx = { url: 'https://Example.com:8080/checkout', ip: V.ip, userAgent: V.userAgent };
  assert.deepEqual(c.checkoutMetadata(ctx, { day: V.day }), { runomine_visitor: V.visitor });
  assert.deepEqual(c.checkoutMetadata(ctx, { user: 42, day: V.day }), { runomine_visitor: V.visitor, runomine_user: '42' });
  assert.deepEqual(c.checkoutMetadata({ ...ctx, user: 'acct_9' }, { day: V.day }), { runomine_visitor: V.visitor, runomine_user: 'acct_9' });

  const express = {
    method: 'POST',
    url: '/checkout',
    originalUrl: '/checkout',
    hostname: 'example.com',
    protocol: 'https',
    ip: '::ffff:' + V.ip,
    headers: { host: 'example.com', 'user-agent': V.userAgent },
  };
  assert.deepEqual(c.checkoutMetadata(express, { user: 7, day: V.day }), { runomine_visitor: V.visitor, runomine_user: '7' });

  const fetchReq = new Request('https://example.com/api/checkout', {
    method: 'POST',
    headers: { 'user-agent': V.userAgent, 'x-forwarded-for': V.ip + ', 10.0.0.1' },
  });
  assert.deepEqual(c.checkoutMetadata(fetchReq, { day: V.day }), { runomine_visitor: V.visitor });

  // The package-root helper uses the default client, synchronously.
  init({ token: V.token, fetch: fakeFetch(), ...fastRetry });
  const today = c.checkoutMetadata(express).runomine_visitor;
  assert.match(today, /^[0-9a-f]{16}$/);
  assert.deepEqual(checkoutMetadata(express, { user: 42 }), { runomine_visitor: today, runomine_user: '42' });
  assert.deepEqual(checkoutMetadata(ctx, { user: 42, day: V.day }), { runomine_visitor: V.visitor, runomine_user: '42' });
  init({ token: '' });
});

test('checkoutMetadata leaves out what is unknown and never throws', async () => {
  const { init, checkoutMetadata } = await import('../dist/esm/index.js');
  const c = createClient({ token: V.token, fetch: fakeFetch(), ...fastRetry });
  // No IP (a job, a webhook): no visitor, never a made-up one.
  assert.deepEqual(c.checkoutMetadata({ url: 'https://example.com/', userAgent: V.userAgent }, { user: 42 }), { runomine_user: '42' });
  assert.deepEqual(c.checkoutMetadata(null, { user: 0 }), { runomine_user: '0' });
  assert.deepEqual(c.checkoutMetadata(undefined), {});
  assert.deepEqual(c.checkoutMetadata(null, { user: '' }), {});
  assert.deepEqual(c.checkoutMetadata({ headers: null }), {});
  // Disabled or no token: the user still goes, the visitor doesn't.
  const ctx = { url: 'https://example.com/', ip: V.ip, userAgent: V.userAgent };
  assert.deepEqual(createClient({ token: '' }).checkoutMetadata(ctx, { user: 'u1' }), { runomine_user: 'u1' });
  assert.deepEqual(createClient({ token: V.token, enabled: false }).checkoutMetadata(ctx), {});
  init({ token: '' });
  assert.deepEqual(checkoutMetadata(ctx, { user: 5 }), { runomine_user: '5' });
  assert.deepEqual(checkoutMetadata(ctx), {});
});

test('uuid v7 ids carry the time', () => {
  const now = Date.UTC(2026, 9, 13, 18, 4, 5, 123);
  const id = uuidv7(undefined, now);
  assert.match(id, UUID7);
  assert.equal(parseInt(id.replace(/-/g, '').slice(0, 12), 16), now);
});

test('batches are chunked at 500 events per POST', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  for (let i = 0; i < 1200; i++) c.track('e' + i, null, { visitor: 'v' });
  await c.flush();
  assert.deepEqual(fetch.calls.map((call) => call.body.events.length), [500, 500, 200]);
  const names = fetch.calls.flatMap((call) => call.body.events.map((e) => e.name));
  assert.equal(new Set(names).size, 1200);
  assert.equal(c.size, 0);
});

test('flushes on its own after flushInterval', async () => {
  const fetch = fakeFetch();
  const c = client(fetch, { flushInterval: 20 });
  c.track('tick', null, { visitor: 'v' });
  assert.equal(fetch.calls.length, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fetch.calls.length, 1);
});

test('retries 5xx twice with backoff, then drops quietly', async () => {
  const fetch = fakeFetch([503]);
  const c = client(fetch);
  c.track('x', null, { visitor: 'v' });
  await c.flush();
  assert.equal(fetch.calls.length, 3);
  assert.equal(c.size, 0);
  c.track('y', null, { visitor: 'v' });
  await c.flush();
  assert.equal(fetch.calls.length, 6, 'a dropped batch does not block later ones');
});

test('retries 429 and succeeds; same event id on every attempt', async () => {
  const fetch = fakeFetch([429, 502, 202]);
  const c = client(fetch);
  c.track('x', null, { visitor: 'v' });
  await c.flush();
  assert.equal(fetch.calls.length, 3);
  assert.equal(new Set(fetch.calls.map((call) => call.body.events[0].id)).size, 1);
});

test('backoff waits between attempts', async () => {
  const fetch = fakeFetch([500]);
  const c = client(fetch, { retryDelays: [30, 60] });
  c.track('x', null, { visitor: 'v' });
  const start = Date.now();
  await c.flush();
  assert.ok(Date.now() - start >= 85, 'waited ~90ms');
});

test('401 and other 4xx are not retried', async () => {
  const fetch = fakeFetch([401]);
  const c = client(fetch);
  c.track('x', null, { visitor: 'v' });
  await c.flush();
  assert.equal(fetch.calls.length, 1);
});

test('network failures never throw and flush still resolves', async () => {
  const fetch = fakeFetch([new TypeError('fetch failed')]);
  const c = client(fetch);
  c.pageview({ url: 'https://example.com/', ip: V.ip, userAgent: 'ua' });
  c.track('x');
  await assert.doesNotReject(c.flush());
  assert.equal(fetch.calls.length, 3);
});

test('a real unreachable server never throws', async () => {
  const c = createClient({ token: V.token, url: 'http://127.0.0.1:9', retryDelays: [1, 1], timeout: 500 });
  c.track('x');
  await assert.doesNotReject(c.flush());
});

test('bad input never throws', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  assert.doesNotThrow(() => {
    c.pageview(undefined);
    c.pageview({});
    c.pageview(null);
    c.track('x', null, null);
    c.track('y', { a: 1 }, { request: Promise.reject(new Error('boom')) });
    c.track('z', null, { request: { headers: { get() { throw new Error('bad headers'); } } } });
  });
  await c.flush();
  const names = fetch.calls.flatMap((call) => call.body.events.map((e) => e.name));
  assert.deepEqual(names.sort(), ['x', 'z']);
});

test('without a token, or disabled, nothing is queued or sent', async () => {
  const fetch = fakeFetch();
  const prev = process.env.RUNOMINE_TOKEN;
  delete process.env.RUNOMINE_TOKEN;
  const noToken = createClient({ fetch });
  const off = createClient({ token: V.token, enabled: false, fetch });
  for (const c of [noToken, off]) {
    assert.equal(c.enabled, false);
    c.track('x');
    c.pageview({ url: 'https://example.com/' });
    await c.flush();
  }
  assert.equal(fetch.calls.length, 0);
  if (prev !== undefined) process.env.RUNOMINE_TOKEN = prev;
});

test('config from the environment', () => {
  const saved = { ...process.env };
  try {
    process.env.RUNOMINE_TOKEN = 'rm_live_env';
    process.env.RUNOMINE_URL = 'https://self.hosted/';
    delete process.env.RUNOMINE_ENABLED;
    let c = createClient();
    assert.equal(c.enabled, true);
    assert.equal(c.endpoint, 'https://self.hosted/api/v1/events');
    process.env.RUNOMINE_ENABLED = 'false';
    c = createClient();
    assert.equal(c.enabled, false);
    delete process.env.RUNOMINE_URL;
    delete process.env.RUNOMINE_ENABLED;
    assert.equal(createClient().endpoint, 'https://runomine.com/api/v1/events');
  } finally {
    for (const k of ['RUNOMINE_TOKEN', 'RUNOMINE_URL', 'RUNOMINE_ENABLED']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('shutdown flushes and then ignores new events', async () => {
  const fetch = fakeFetch();
  const c = client(fetch);
  c.track('before', null, { visitor: 'v' });
  await c.shutdown();
  c.track('after', null, { visitor: 'v' });
  await c.flush();
  assert.deepEqual(fetch.calls.flatMap((call) => call.body.events.map((e) => e.name)), ['before']);
});

test('flushes queued events on beforeExit', () => {
  // A child process that queues an event and then simply lets the event loop end.
  const script = `
    import { createClient } from ${JSON.stringify(new URL('../dist/esm/index.js', import.meta.url).href)};
    const c = createClient({ token: 't', url: 'https://rm.test', flushInterval: 60000, fetch: async (url, init) => {
      console.log('sent', JSON.parse(init.body).events.length);
      return { status: 202, text: async () => '' };
    } });
    c.track('a'); c.track('b');
  `;
  return import('node:child_process').then(({ spawnSync }) => {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(out.stderr, '');
    assert.equal(out.stdout.trim(), 'sent 2');
  });
});
