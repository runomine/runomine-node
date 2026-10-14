# Changelog

## 0.2.0

- Page views take `props`, with the same rules as events (flat, up to 20 keys, string or number values):
  `pageview(input, { props })`, `props` on a plain `PageviewInput`, and a `props: (req, res) => …` option on the
  Express middleware. runomine stores them as the page view's dims.
- Samples, an app's own ops numbers for runomine's Live page: `sample(data, ts?)` and `samples([{ data, ts }])`, on
  the client and as default-client helpers in both entries, sent at once to `POST /api/v1/samples`. They resolve
  `true` when runomine took the call.

## 0.1.0

- First release: client (pageviews, events with props and revenue, batching, retries, the contract's visitor hash,
  checkout metadata), Express middleware, Next.js App Router support (`@runomine/node/next`, Edge-safe) and helpers
  for Fetch-API frameworks.
