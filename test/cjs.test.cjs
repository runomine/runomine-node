// The CommonJS build: require() from plain JS projects.
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('require("@runomine/node") works and hashes the vector', () => {
  const runomine = require('../dist/cjs/index.js');
  assert.equal(typeof runomine.track, 'function');
  assert.equal(typeof runomine.express, 'function');
  assert.equal(typeof runomine.default.express, 'function');
  assert.equal(typeof runomine.checkoutMetadata, 'function');
  assert.equal(typeof runomine.default.checkoutMetadata, 'function');
  assert.equal(
    runomine.visitorHash(
      'rm_live_test_0123456789abcdef',
      '203.0.113.9',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      'example.com',
      '2026-10-13',
    ),
    '5f9e1bebe31e8bf5',
  );
});

test('require("@runomine/node/next") works, Web Crypto path', async () => {
  const next = require('../dist/cjs/next.js');
  assert.equal(typeof next.withRunomine, 'function');
  assert.equal(
    await next.visitorHashAsync(
      'rm_live_test_0123456789abcdef',
      '203.0.113.9',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      'example.com',
      '2026-10-13',
    ),
    '5f9e1bebe31e8bf5',
  );
});
