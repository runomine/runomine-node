import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { visitorHash, visitorHashAsync } from '../dist/esm/index.js';
import { visitorHashWith } from '../dist/esm/hash-web.js';
import { VECTOR as V } from './helpers.mjs';

test('contract vector: salt', () => {
  const salt = createHmac('sha256', V.token).update('runomine:' + V.day).digest('hex');
  assert.equal(salt, V.salt);
});

test('contract vector: node:crypto path (sync visitorHash)', () => {
  assert.equal(visitorHash(V.token, V.ip, V.userAgent, V.host, V.day), V.visitor);
});

test('contract vector: Web Crypto path (global crypto.subtle)', { skip: !globalThis.crypto?.subtle && 'no global Web Crypto (Node 18)' }, async () => {
  assert.equal(await visitorHashWith(globalThis.crypto.subtle, V.token, V.ip, V.userAgent, V.host, V.day), V.visitor);
  assert.equal(await visitorHashAsync(V.token, V.ip, V.userAgent, V.host, V.day), V.visitor);
});

test('contract vector: Web Crypto path (node:crypto webcrypto)', async () => {
  assert.equal(await visitorHashWith(webcrypto.subtle, V.token, V.ip, V.userAgent, V.host, V.day), V.visitor);
});

test('contract vector: Web Crypto fallback when there is no global crypto (Node 18)', () => {
  const hashWeb = fileURLToPath(new URL('../dist/esm/hash-web.js', import.meta.url));
  const script = `
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    const { visitorHashAsync } = await import(${JSON.stringify('file://' + hashWeb)});
    if (globalThis.crypto) throw new Error('crypto still global');
    console.log(await visitorHashAsync(${JSON.stringify(V.token)}, ${JSON.stringify(V.ip)}, ${JSON.stringify(V.userAgent)}, ${JSON.stringify(V.host)}, ${JSON.stringify(V.day)}));
  `;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(out.stderr, '');
  assert.equal(out.stdout.trim(), V.visitor);
});

test('host is lowercased and stripped of its port', async () => {
  assert.equal(visitorHash(V.token, V.ip, V.userAgent, 'Example.COM:8443', V.day), V.visitor);
  assert.equal(await visitorHashAsync(V.token, V.ip, V.userAgent, 'EXAMPLE.com:80', V.day), V.visitor);
});

test('day accepts a Date and defaults to today (UTC)', () => {
  assert.equal(visitorHash(V.token, V.ip, V.userAgent, V.host, new Date('2026-10-13T23:59:59.999Z')), V.visitor);
  assert.notEqual(visitorHash(V.token, V.ip, V.userAgent, V.host, '2026-10-14'), V.visitor);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(visitorHash(V.token, V.ip, V.userAgent, V.host), visitorHash(V.token, V.ip, V.userAgent, V.host, today));
});

test('node and web paths agree on arbitrary input', async () => {
  for (const [ip, ua, host] of [
    ['', '', ''],
    ['2001:db8::1', 'curl/8.0 ñ €', 'sub.example.org'],
    ['10.0.0.1', 'x'.repeat(500), 'localhost'],
  ]) {
    assert.equal(await visitorHashAsync('rm_live_abc', ip, ua, host, '2026-01-01'), visitorHash('rm_live_abc', ip, ua, host, '2026-01-01'));
  }
});
