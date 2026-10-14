# @runomine/node

Cookieless analytics that counts money, not just visits, sent **from your Node backend** to
[runomine](https://runomine.com). Pageviews and business events (signups, purchases with revenue) go out in batches,
in the background. Your app is never blocked and never throws because of runomine.

- Node 18+ and Edge runtimes (Next.js middleware). Uses only web-standard APIs, so Bun and Deno should work too.
- Zero dependencies. ESM and CommonJS builds, TypeScript types included.
- Express middleware, Next.js App Router (`middleware.ts` / `proxy.ts` and server `track`), and any
  Fetch-API framework (Hono, Remix, SvelteKit) through `fromRequest`.

## Install

```sh
npm install @runomine/node
```

Before it's on npm, install it from this repository (the prebuilt `dist/` is committed, so no build step is needed):

```sh
npm install github:runomine/runomine-node        # or: pnpm add / yarn add / bun add github:runomine/runomine-node
npm install "github:runomine/runomine-node#<commit>"   # pin a commit, tag or branch
```

`package.json` then has `"@runomine/node": "github:runomine/runomine-node"`, and imports are the same as from npm.

To vendor it instead (no network access to GitHub in CI), pack a clone and commit the tarball:
`npm pack /path/to/runomine-node --pack-destination vendor`, then `npm install ./vendor/runomine-node-0.1.0.tgz`.

Then set the token of your site (runomine → Sites → your site):

```sh
RUNOMINE_TOKEN=rm_live_…
```

## Express

```js
import runomine from '@runomine/node';

app.set('trust proxy', true); // if you're behind a proxy or load balancer, so req.ip is the visitor's
app.use(runomine.express());
```

That's it: every `GET` answered `200` with `text/html` is recorded **after** the response is sent. Assets (any path
with a file extension), prefetches (`Purpose`/`Sec-Purpose: prefetch`) and ignored paths are skipped.

```js
app.use(
  runomine.express({
    ignore: ['/admin', '/healthz', /^\/internal\//], // prefixes, RegExps, or (path) => boolean
    user: (req) => req.user?.id,                      // your own user id, when logged in
  }),
);
```

The IP comes from `req.ip`, so it honours Express's `trust proxy`. The country comes from `CF-IPCountry` or
`CloudFront-Viewer-Country` when your CDN sets them.

CommonJS works the same: `const runomine = require('@runomine/node')`.

## Track events

```js
import { track } from '@runomine/node';

// A signup, from a request handler: pass the request so the event joins the visit
track('signup', { plan: 'free' }, { user: user.id, request: req });

// A purchase with revenue (amount in major units: 4.99, not 499)
track('purchase', { plan: 'rent', film: 'the-third-man' }, {
  revenue: { amount: 4.99, currency: 'EUR' },
  user: user.id,
  request: req,
});
```

`request` can be an Express/Node request, a Fetch `Request`, or a plain `{ url, ip, userAgent }`. Names follow
`[a-z0-9_.:-]{1,64}`; `props` is a flat object of up to 20 string or number values.

**Without a request** (a payment webhook, a queued job, a script) the event carries no visitor, and runomine
attributes it through `user`. To tie a webhook's purchase to the visit that started it, capture the visitor where
the visitor is and keep it with the order:

```js
import { visitorFor, track } from '@runomine/node';

// at checkout, in the visitor's request
order.runomineVisitor = visitorFor(req);

// later, in your own payment webhook (only for payments no connected provider sees)
track('purchase', { plan: order.plan }, {
  revenue: { amount: order.total, currency: 'EUR' },
  user: order.userId,
  visitor: order.runomineVisitor,
});
```

## Next.js (App Router)

### 1. Pageviews: `middleware.ts` (or `proxy.ts` on Next 16+)

```ts
// middleware.ts
import { withRunomine } from '@runomine/node/next';

export default withRunomine();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

Already have a middleware? Wrap it:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { withRunomine } from '@runomine/node/next';

export default withRunomine(
  async (request: NextRequest) => {
    // …your logic…
    return NextResponse.next();
  },
  { ignore: ['/api', '/admin'] },
);
```

It records **document requests** (`GET`, `Accept: text/html`) server-side, and skips `/_next/*`, `/api/*` (the
default `ignore`), assets, and anything your middleware redirects or answers with a non-200. The Next.js router's
prefetches and soft navigations (RSC fetches) are left out because they don't ask for `text/html` (Next.js also
strips their `RSC`/`Next-Router-Prefetch` headers before your middleware runs); browser prefetches and prerenders
are left out by their `Purpose`/`Sec-Purpose: prefetch` header. Events are sent with `event.waitUntil`, so the
response isn't delayed. It runs on the Edge runtime (Web Crypto) and on Node (`proxy.ts`); the visitor hash is
identical on both. Behind your own proxy, the page URL's host comes from `X-Forwarded-Host`/`Host`, not from the
address `next start` listens on.

Middleware runs before the page renders, so it can't see a 404 from the page itself: keep unknown routes out with
`ignore` or the `matcher` if that matters to you.

### 2. Client-side navigations: the beacon

After the first load, Next.js navigates in the browser (`<Link>`, `router.push`) and the server only sees RSC
fetches, which aren't pageviews. Those soft navigations are only seen by the beacon, `r.js`. Add it to your root
layout:

```tsx
// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="https://runomine.com/r.js" data-site="site_xxxxxxxxxxxx" strategy="afterInteractive" />
      </body>
    </html>
  );
}
```

The beacon and the library compute the same visitor hash, so a person is counted once. If you use the beacon for
every navigation, you can skip the middleware, or keep it for visitors who block scripts.

### 3. Server events: route handlers and server actions

```ts
// app/actions.ts
'use server';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { track, flush } from '@runomine/node/next';

export async function signup(form: FormData) {
  const user = await createUser(form);
  track('signup', { plan: 'free' }, { user: user.id, headers: headers() }); // headers() awaited or not
  after(() => flush());
}
```

```ts
// app/api/checkout/route.ts
import { after } from 'next/server';
import { track, flush } from '@runomine/node/next';

export async function POST(request: Request) {
  const order = await checkout(request);
  track('purchase', { plan: order.plan }, {
    revenue: { amount: order.total, currency: 'EUR' },
    user: order.userId,
    request,
  });
  after(() => flush());
  return Response.json(order);
}
```

With `headers` only (a server action), the event's URL is the `Referer`, i.e. the page the user was on.
On serverless platforms the function may freeze right after the response, so flush in `after()` (Next 15.1+) or
`await flush()` before returning. On a long-running server the queue also flushes on its own every 2 seconds.

## Fetch-API frameworks (Hono, Remix, SvelteKit, Bun, Deno)

`fromRequest(request, { ip })` turns a Fetch `Request` into what runomine needs, and `isPageview(request, response)`
applies the library's rule (GET, HTML, 200, not a prefetch, not an asset). Import from `@runomine/node/next` on
Edge runtimes (Cloudflare Workers, Vercel Edge), from `@runomine/node` on Node.

```ts
// Hono
import { getConnInfo } from 'hono/bun'; // or hono/cloudflare-workers, hono/deno, @hono/node-server/conninfo
import { pageview, fromRequest, isPageview, flush } from '@runomine/node/next';

app.use(async (c, next) => {
  await next();
  if (isPageview(c.req.raw, c.res)) {
    pageview(fromRequest(c.req.raw, { ip: getConnInfo(c).remote.address }));
    try {
      c.executionCtx.waitUntil(flush()); // Cloudflare Workers
    } catch {
      // not on Workers: the 2-second timer flushes
    }
  }
});
```

```ts
// SvelteKit: src/hooks.server.ts
import { pageview, fromRequest, isPageview } from '@runomine/node';

export const handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (isPageview(event.request, response)) {
    pageview(fromRequest(event.request, { ip: event.getClientAddress() }));
  }
  return response;
};
```

```ts
// Remix / React Router: in a loader or entry.server, with the request you're given
import { track, fromRequest } from '@runomine/node';
track('signup', null, { request: fromRequest(request), user: user.id });
```

Without `{ ip }`, `fromRequest` reads `CF-Connecting-IP`, `X-Real-IP`, then the first `X-Forwarded-For`; only rely on
those behind a proxy that sets them.

## Revenue from your payment provider

runomine takes revenue from your payment provider, not from prices in your code: connect Stripe, Paddle, Lemon
Squeezy, Shopify or PayPal in the site's settings → **Integrations**, and runomine reads every sale, renewal and
refund from it. To attribute a sale to the visit and the person behind it, pass two identifiers when you create the
checkout; runomine reads them back from the provider.

```js
import { checkoutMetadata } from '@runomine/node';

checkoutMetadata(req, { user: req.user?.id }); // { runomine_visitor: '5f9e1bebe31e8bf5', runomine_user: '42' }
```

`req` is an Express/Node request or a Fetch `Request` (or a plain `{ url, ip, userAgent }`), read the same way as for
pageviews. `runomine_visitor` is the request's visitor hash and `runomine_user` your user id, as a string. Only keys
with a value are returned: without a token or the request's IP there is no visitor (never a made-up one). In
Next.js, import it from `@runomine/node/next`: it returns a promise and also takes `headers()`.

```ts
// app/actions.ts (Next.js server action)
const metadata = await checkoutMetadata(headers(), { user: session.userId });
```

Once a provider is connected, **don't also send `revenue`** with `track('purchase', …)`: it would be counted twice.
Send the event without revenue, or not at all. (The webhook example above is for payments that don't go through a
connected provider.)

**Stripe Checkout**: `client_reference_id` is used as the user when `runomine_user` is missing. For subscriptions,
also put the metadata on the subscription so renewals carry the user.

```js
const metadata = checkoutMetadata(req, { user: req.user.id });

const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [{ price: 'price_123', quantity: 1 }],
  success_url: 'https://example.com/billing/done',
  client_reference_id: String(req.user.id),
  metadata,
  subscription_data: { metadata }, // renewals
});

// Without Checkout, on the PaymentIntent:
await stripe.paymentIntents.create({ amount: 499, currency: 'eur', metadata });
```

**Paddle Billing**: render the values into the page and pass them as `customData` to Paddle.js, or as `custom_data`
when you create the transaction through the API.

```js
// in the browser, with `metadata` rendered by your server
Paddle.Checkout.open({ items: [{ priceId: 'pri_123', quantity: 1 }], customData: metadata });

// or server-side
await paddle.transactions.create({ items: [{ priceId: 'pri_123', quantity: 1 }], customData: checkoutMetadata(req, { user }) });
```

**Lemon Squeezy**: `checkout_data.custom` when you create the checkout through the API, or URL parameters on a
checkout link (`?checkout[custom][runomine_visitor]=…&checkout[custom][runomine_user]=…`).

```js
attributes: { checkout_data: { custom: checkoutMetadata(req, { user }) } },
```

**Shopify** (headless, Storefront API cart): cart attributes, which become the order's note attributes.

```js
const attributes = Object.entries(checkoutMetadata(req, { user })).map(([key, value]) => ({ key, value }));
// cartCreate(input: { lines: [...], attributes })
```

**PayPal Orders v2**: `custom_id` on the purchase unit, as a query string (127 characters at most).

```js
purchase_units: [{
  amount: { currency_code: 'EUR', value: '4.99' },
  custom_id: new URLSearchParams(checkoutMetadata(req, { user })).toString(),
}],
```

## Privacy

- **The IP never leaves your server.** The library hashes it on your machine, with the user agent, the host and a
  salt derived from your token and today's date (UTC), and sends only the first 16 hex characters of that hash.
- No cookies, no storage, no fingerprinting. The hash changes every day and differs per site, so a person can't be
  followed across days or sites.
- The user agent is sent so runomine can drop bots and group devices and browsers; runomine discards it after that.
- `user` is only sent when you pass it.

The hash is exported if you need it: `visitorHash(token, ip, userAgent, host, day?)` (sync, `node:crypto`) and
`visitorHashAsync(...)` (Web Crypto, any runtime). Both reproduce the contract's test vector.

## Configuration

| Option (`createClient` / `init`) | Environment | Default | |
|---|---|---|---|
| `token` | `RUNOMINE_TOKEN` | none | Server token, `rm_live_…`. Without it the library does nothing. |
| `url` | `RUNOMINE_URL` | `https://runomine.com` | Where to send events. |
| `enabled` | `RUNOMINE_ENABLED` | `true` when there is a token | Set `false` in tests or development. |
| `debug` | `RUNOMINE_DEBUG` | `false` | Log dropped batches and rejected events with `console.warn`, or pass `(message, error) => …`. |
| `flushInterval` | | `2000` | Milliseconds between automatic flushes. |
| `batchSize` | | `500` | Events per request (max 500). |
| `retryDelays` | | `[1000, 3000]` | Backoff before each retry on 5xx, 429 or a network error; then the batch is dropped. |
| `timeout` | | `5000` | Per-request timeout in milliseconds. |
| `maxQueue` | | `10000` | Events kept in memory while runomine is unreachable; the oldest go first. |
| `fetch` | | global `fetch` | Custom fetch (proxies, tests). |

The top-level functions use a default client configured from the environment. To configure it in code:

```js
import { init } from '@runomine/node';
init({ token: process.env.MY_TOKEN, debug: true });
```

Or create independent clients (e.g. one per site):

```js
import { createClient } from '@runomine/node';
const shop = createClient({ token: process.env.SHOP_TOKEN });
shop.track('purchase', null, { revenue: { amount: 10, currency: 'EUR' }, request: req });
app.use(runomine.express({ client: shop }));
```

## Delivery

Events wait in memory and go out in batches of up to 500: every 2 seconds, when 500 are queued, on `flush()`, and
when the process is about to exit (`beforeExit`). `5xx` and `429` are retried twice with backoff, then dropped
quietly; `401` (a bad token) is not retried. Every event has a UUID v7 `id`, so a retried batch is stored once.

`process.exit()` skips `beforeExit`: call `await shutdown()` first in scripts and on `SIGTERM`.

```js
process.on('SIGTERM', async () => {
  await runomine.shutdown();
  process.exit(0);
});
```

## API

From `@runomine/node` (Node) and `@runomine/node/next` (Edge-safe; same API, async hashing):

| | |
|---|---|
| `pageview(input)` | Record a pageview from a `{ url, ip, userAgent, referrer, country, user }`, a Fetch `Request` or a Node request. |
| `track(name, props?, { revenue, user, request, visitor, url })` | Record a business event. `@runomine/node/next` also takes `headers`. |
| `flush()` / `shutdown()` | Send everything now (never rejects) / flush and stop. |
| `express(options)` | Express middleware (`@runomine/node` only). |
| `withRunomine(middleware?, options)` | Next.js middleware/proxy wrapper (`@runomine/node/next` only). |
| `visitorFor(request)` | The visitor hash of a request, with your token (sync on Node, a promise in `/next`). |
| `checkoutMetadata(request, { user })` | `{ runomine_visitor, runomine_user }` for your payment provider's checkout (sync on Node, a promise in `/next`). |
| `visitorHash(...)` / `visitorHashAsync(...)` | The raw hash. |
| `fromRequest(request, { ip, user })` / `isPageview(request, response?)` | Helpers for Fetch-API frameworks. |
| `createClient(options)` / `init(options)` / `defaultClient()` | Clients. |

The library does no classification: sources, bots, devices and countries-from-IP are all worked out by runomine.

## Development

```sh
npm install
npm test        # builds dist/ (tsc, ESM + CJS) and runs node:test
```

`dist/` is committed so the package installs from git or a tarball without a build. Run `npm run build` and
commit `dist/` with any change to `src/`.

## License

MIT. See [LICENSE](LICENSE).
