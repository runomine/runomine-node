import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import runomine, { createClient } from '../dist/esm/index.js';
import { VECTOR as V, fakeFetch, fastRetry } from './helpers.mjs';

/** An Express-like request: req.ip / req.hostname / req.protocol as Express computes them. */
function fakeReq({ url = '/pricing?utm_source=newsletter', headers = {}, ...rest } = {}) {
  return {
    method: 'GET',
    url,
    originalUrl: url,
    path: url.split('?')[0],
    hostname: 'example.com',
    protocol: 'https',
    ip: V.ip,
    headers: {
      host: 'example.com',
      'user-agent': V.userAgent,
      accept: 'text/html',
      referer: 'https://www.google.com/',
      ...headers,
    },
    ...rest,
  };
}

function fakeRes(status = 200, type = 'text/html; charset=utf-8') {
  const res = new EventEmitter();
  res.statusCode = status;
  res.getHeader = (name) => (name.toLowerCase() === 'content-type' ? (type ?? undefined) : undefined);
  return res;
}

/** Runs the middleware for one request and returns the events sent. */
async function run(req, res, options = {}) {
  const fetch = fakeFetch();
  const client = createClient({ token: V.token, fetch, ...fastRetry });
  const mw = runomine.express({ client, ...options });
  let nextCalled = false;
  mw(req, res, () => (nextCalled = true));
  assert.ok(nextCalled, 'next() is always called');
  res.emit('finish');
  await client.flush();
  return fetch.calls.flatMap((c) => c.body.events);
}

test('records GET 200 text/html after finish', async () => {
  const events = await run(fakeReq(), fakeRes());
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, 'pageview');
  assert.equal(e.url, 'https://example.com/pricing?utm_source=newsletter');
  assert.equal(e.referrer, 'https://www.google.com/');
  assert.equal(e.user_agent, V.userAgent);
  assert.match(e.visitor, /^[0-9a-f]{16}$/);
});

test('visitor uses req.ip (trust proxy) and req.hostname', async () => {
  const fetch = fakeFetch();
  const client = createClient({ token: V.token, fetch, ...fastRetry });
  const mw = runomine.express({ client });
  const req = fakeReq();
  const res = fakeRes();
  mw(req, res, () => {});
  res.emit('finish');
  await client.flush();
  const e = fetch.calls[0].body.events[0];
  const { visitorHash } = await import('../dist/esm/index.js');
  assert.equal(e.visitor, visitorHash(V.token, V.ip, V.userAgent, 'example.com', e.ts.slice(0, 10)));
});

test('does not record before the response finishes', async () => {
  const fetch = fakeFetch();
  const client = createClient({ token: V.token, fetch, ...fastRetry });
  runomine.express({ client })(fakeReq(), fakeRes(), () => {});
  await client.flush();
  assert.equal(fetch.calls.length, 0);
});

test('skips non-GET, non-200, non-HTML', async () => {
  assert.equal((await run(fakeReq({ method: 'POST' }), fakeRes())).length, 0);
  assert.equal((await run(fakeReq(), fakeRes(404))).length, 0);
  assert.equal((await run(fakeReq(), fakeRes(304))).length, 0);
  assert.equal((await run(fakeReq(), fakeRes(301))).length, 0);
  assert.equal((await run(fakeReq(), fakeRes(200, 'application/json'))).length, 0);
  assert.equal((await run(fakeReq(), fakeRes(200, null))).length, 0);
});

test('skips assets', async () => {
  for (const url of ['/app.js', '/styles/site.css', '/logo.png', '/favicon.ico', '/robots.txt', '/fonts/x.woff2']) {
    assert.equal((await run(fakeReq({ url }), fakeRes())).length, 0, url);
  }
  assert.equal((await run(fakeReq({ url: '/about.html' }), fakeRes())).length, 1);
});

test('skips configured paths: prefix, RegExp, function', async () => {
  const ignore = ['/admin', /^\/health/];
  assert.equal((await run(fakeReq({ url: '/admin' }), fakeRes(), { ignore })).length, 0);
  assert.equal((await run(fakeReq({ url: '/admin/users?x=1' }), fakeRes(), { ignore })).length, 0);
  assert.equal((await run(fakeReq({ url: '/healthz' }), fakeRes(), { ignore })).length, 0);
  assert.equal((await run(fakeReq({ url: '/administer' }), fakeRes(), { ignore })).length, 1);
  assert.equal((await run(fakeReq({ url: '/x' }), fakeRes(), { ignore: (p) => p === '/x' })).length, 0);
});

test('skips prefetches', async () => {
  for (const headers of [{ purpose: 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }, { 'x-purpose': 'preview' }, { 'x-moz': 'prefetch' }]) {
    assert.equal((await run(fakeReq({ headers }), fakeRes())).length, 0, JSON.stringify(headers));
  }
});

test('country from CF-IPCountry / CloudFront-Viewer-Country, user from the resolver', async () => {
  let [e] = await run(fakeReq({ headers: { 'cf-ipcountry': 'es' } }), fakeRes(), { user: (req) => req.user?.id });
  assert.equal(e.country, 'ES');
  assert.equal(e.user, undefined);
  const req = fakeReq({ headers: { 'cloudfront-viewer-country': 'PT' } });
  req.user = { id: 42 };
  [e] = await run(req, fakeRes(), { user: (r) => r.user?.id });
  assert.equal(e.country, 'PT');
  assert.equal(e.user, '42');
  [e] = await run(fakeReq({ headers: { 'cf-ipcountry': 'XX' } }), fakeRes());
  assert.equal(e.country, undefined);
});

test('a throwing user resolver never breaks the app', async () => {
  const events = await run(fakeReq(), fakeRes(), { user: () => { throw new Error('boom'); } });
  assert.equal(events.length, 0);
});

test('works with a real node:http server', async () => {
  const fetch = fakeFetch();
  const client = createClient({ token: V.token, fetch, ...fastRetry });
  const mw = runomine.express({ client });
  const server = http.createServer((req, res) => {
    mw(req, res, () => {
      res.setHeader('content-type', req.url === '/data' ? 'application/json' : 'text/html');
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await (await globalThis.fetch(base + '/hello?a=1', { headers: { 'user-agent': 'test-ua' } })).text();
  await (await globalThis.fetch(base + '/data')).text();
  server.close();
  await new Promise((r) => setTimeout(r, 20));
  await client.flush();
  const events = fetch.calls.flatMap((c) => c.body.events);
  assert.equal(events.length, 1);
  assert.equal(events[0].url, `${base}/hello?a=1`);
  assert.equal(events[0].user_agent, 'test-ua');
});
