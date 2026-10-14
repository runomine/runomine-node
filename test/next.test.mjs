import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import next, { withRunomine, createClient, init, track, flush, fromRequest, isPageview, visitorFor, checkoutMetadata } from '../dist/esm/next.js';
import { VECTOR as V, fakeFetch, fastRetry } from './helpers.mjs';

function doc(path = '/pricing?utm_source=x', headers = {}, init = {}) {
  return new Request('https://example.com' + path, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': V.userAgent,
      'x-forwarded-for': V.ip + ', 10.0.0.1',
      referer: 'https://www.google.com/',
      ...headers,
    },
    ...init,
  });
}

function setup(options = {}) {
  const fetch = fakeFetch();
  const client = createClient({ token: V.token, fetch, ...fastRetry });
  const waits = [];
  const event = { waitUntil: (p) => waits.push(p) };
  return { fetch, client, waits, event, options: { client, ...options } };
}

async function sent(s) {
  await Promise.all(s.waits);
  await s.client.flush();
  return s.fetch.calls.flatMap((c) => c.body.events);
}

test('records a document request and flushes through event.waitUntil', async () => {
  const s = setup();
  const mw = withRunomine(s.options);
  const out = await mw(doc(), s.event);
  assert.equal(out, undefined, 'no inner middleware: continue');
  assert.equal(s.waits.length, 1);
  await s.waits[0];
  assert.equal(s.fetch.calls.length, 1, 'sent within waitUntil, not by the timer');
  const [e] = s.fetch.calls[0].body.events;
  assert.equal(e.type, 'pageview');
  assert.equal(e.url, 'https://example.com/pricing?utm_source=x');
  assert.equal(e.referrer, 'https://www.google.com/');
  assert.equal(e.user_agent, V.userAgent);
  const { visitorHash } = await import('../dist/esm/index.js');
  assert.equal(e.visitor, visitorHash(V.token, V.ip, V.userAgent, 'example.com', e.ts.slice(0, 10)), 'Web Crypto hash == node hash');
});

test('wraps an inner middleware and returns its response', async () => {
  const s = setup();
  const marker = new Response(null, { status: 200, headers: { 'x-middleware-next': '1' } });
  const mw = withRunomine(async () => marker, s.options);
  assert.equal(await mw(doc(), s.event), marker);
  assert.equal((await sent(s)).length, 1);
});

test('skips Next.js prefetches and RSC requests', async () => {
  for (const headers of [
    { 'next-router-prefetch': '1' },
    { purpose: 'prefetch' },
    { 'sec-purpose': 'prefetch' },
    { rsc: '1', accept: 'text/x-component' },
    { accept: 'text/x-component' },
  ]) {
    const s = setup();
    await withRunomine(s.options)(doc('/page', headers), s.event);
    assert.equal((await sent(s)).length, 0, JSON.stringify(headers));
  }
});

test('skips assets, /_next, /api, ignored paths and non-GET', async () => {
  const cases = [
    doc('/_next/static/chunks/main.js'),
    doc('/_next/image?url=x'),
    doc('/_next/data/abc/page.json'),
    doc('/favicon.ico'),
    doc('/images/hero.webp'),
    doc('/api/checkout'),
    doc('/admin/users'),
    doc('/page', {}, { method: 'POST', body: 'x' }),
    doc('/page', { accept: 'application/json' }),
  ];
  for (const req of cases) {
    const s = setup({ ignore: ['/admin', '/api'] });
    await withRunomine(s.options)(req, s.event);
    assert.equal((await sent(s)).length, 0, req.method + ' ' + req.url);
  }
});

test('skips when the inner middleware redirects or answers non-HTML', async () => {
  for (const res of [Response.redirect('https://example.com/login', 307), new Response('{}', { headers: { 'content-type': 'application/json' } }), new Response('no', { status: 401 })]) {
    const s = setup();
    await withRunomine(() => res, s.options)(doc(), s.event);
    assert.equal((await sent(s)).length, 0, String(res.status));
  }
});

test('user resolver (async) and country header', async () => {
  const s = setup({ user: async () => 'u_7' });
  await withRunomine(s.options)(doc('/', { 'cf-ipcountry': 'de' }), s.event);
  const [e] = await sent(s);
  assert.equal(e.user, 'u_7');
  assert.equal(e.country, 'DE');
});

test('works without an event (no waitUntil): the timer or flush() sends it', async () => {
  const s = setup();
  await withRunomine(s.options)(doc(), undefined);
  assert.equal((await sent(s)).length, 1);
});

test('a throwing user resolver never breaks the middleware', async () => {
  const s = setup({ user: () => { throw new Error('boom'); } });
  const res = await withRunomine(() => 'next', s.options)(doc(), s.event);
  assert.equal(res, 'next');
});

test('server track() with headers() (a promise, as in Next 15) and with a Request', async () => {
  const fetch = fakeFetch();
  init({ token: V.token, fetch, ...fastRetry });
  const h = new Headers({ 'user-agent': V.userAgent, 'x-forwarded-for': V.ip, referer: 'https://example.com/checkout', host: 'example.com' });
  track('purchase', { plan: 'pro' }, { revenue: { amount: 49, currency: 'EUR' }, user: 42, headers: Promise.resolve(h), ts: '2026-10-13T10:00:00Z' });
  track('signup', undefined, { request: new Request('https://example.com/api/signup', { method: 'POST', headers: h }), ts: '2026-10-13T10:00:00Z' });
  await flush();
  const events = fetch.calls[0].body.events;
  const purchase = events.find((e) => e.name === 'purchase');
  const signup = events.find((e) => e.name === 'signup');
  assert.equal(purchase.name, 'purchase');
  assert.equal(purchase.url, 'https://example.com/checkout', 'server actions: the page is the Referer');
  assert.equal(purchase.visitor, V.visitor);
  assert.deepEqual(purchase.revenue, { amount: 49, currency: 'EUR' });
  assert.equal(purchase.user, '42');
  assert.equal(signup.url, 'https://example.com/api/signup');
  assert.equal(signup.visitor, V.visitor);
  init({ token: '' });
});

test('next visitorFor(headers()) and track without a request omits visitor', async () => {
  const fetch = fakeFetch();
  init({ token: V.token, fetch, ...fastRetry });
  const h = new Headers({ 'user-agent': V.userAgent, 'x-forwarded-for': V.ip, referer: 'https://example.com/checkout' });
  assert.equal(await visitorFor(Promise.resolve(h), V.day), V.visitor);
  assert.equal(await visitorFor(new Request('https://example.com/', { headers: h }), V.day), V.visitor);
  assert.equal(await visitorFor(null), undefined);
  track('purchase', null, { user: 'u1', revenue: { amount: 5, currency: 'EUR' } });
  track('purchase_2', null, { user: 'u1', visitor: V.visitor });
  await flush();
  const [a, b] = fetch.calls[0].body.events.sort((x, y) => x.name.localeCompare(y.name));
  assert.ok(!('visitor' in a));
  assert.equal(b.visitor, V.visitor);
  init({ token: '' });
});

test('next checkoutMetadata(headers()) and from a Request', async () => {
  init({ token: V.token, fetch: fakeFetch(), ...fastRetry });
  const h = new Headers({ 'user-agent': V.userAgent, 'x-forwarded-for': V.ip, referer: 'https://example.com/pricing' });
  assert.deepEqual(await checkoutMetadata(Promise.resolve(h), { user: 42, day: V.day }), { runomine_visitor: V.visitor, runomine_user: '42' });
  assert.deepEqual(await checkoutMetadata(new Request('https://example.com/api/checkout', { headers: h }), { day: V.day }), { runomine_visitor: V.visitor });
  assert.deepEqual(await checkoutMetadata(null, { user: 'u1' }), { runomine_user: 'u1' });
  assert.deepEqual(await checkoutMetadata(Promise.reject(new Error('no request scope')), { user: 7 }), { runomine_user: '7' });
  const today = await visitorFor(h);
  assert.deepEqual(await checkoutMetadata(h), { runomine_visitor: today });
  init({ token: '' });
  assert.deepEqual(await checkoutMetadata(h, { user: 7 }), { runomine_user: '7' });
});

test('default export carries the helpers', () => {
  assert.equal(typeof next.withRunomine, 'function');
  assert.equal(typeof next.track, 'function');
  assert.equal(typeof next.checkoutMetadata, 'function');
});

test('fromRequest uses the Host / X-Forwarded-Host header when the server URL is its bind address', () => {
  let ctx = fromRequest(new Request('http://localhost:3000/x?a=1', { headers: { host: 'Example.com' } }));
  assert.equal(ctx.url, 'http://Example.com/x?a=1');
  assert.equal(ctx.host, 'example.com');
  ctx = fromRequest(new Request('http://localhost:3000/x', { headers: { host: 'localhost:3000', 'x-forwarded-host': 'shop.example.com', 'x-forwarded-proto': 'https' } }));
  assert.equal(ctx.url, 'https://shop.example.com/x');
  assert.equal(ctx.host, 'shop.example.com');
  ctx = fromRequest(new Request('https://example.com/y', { headers: { host: 'example.com' } }));
  assert.equal(ctx.url, 'https://example.com/y', 'unchanged when they agree');
});

test('fromRequest + isPageview for Fetch-API frameworks', () => {
  const req = doc('/a', { 'x-real-ip': '198.51.100.1' });
  const ctx = fromRequest(req);
  assert.equal(ctx.ip, '198.51.100.1');
  assert.equal(fromRequest(req, { ip: '192.0.2.1' }).ip, '192.0.2.1');
  assert.equal(ctx.host, 'example.com');
  assert.ok(isPageview(req, new Response('<html>', { headers: { 'content-type': 'text/html' } })));
  assert.ok(!isPageview(req, new Response('x', { status: 404, headers: { 'content-type': 'text/html' } })));
});

test('the next entry graph has no static node: imports (Edge-safe)', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /^\s*import[^;]*from\s*['"]node:/m, file);
    assert.doesNotMatch(src, /\bprocess\.(on|env)\b/, file + ' must reach process through globalThis guards');
    for (const m of src.matchAll(/from\s*['"](\.\/[^'"]+)['"]/g)) visit(new URL(m[1], new URL(file, import.meta.url)).href);
  };
  visit('../dist/esm/next.js');
  assert.ok(![...seen].some((f) => f.endsWith('hash-node.js') || f.endsWith('/index.js')), 'next.js must not pull the node entry');
});
