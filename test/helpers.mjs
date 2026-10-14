// Shared test helpers (no tests in this file).
export const VECTOR = {
  token: 'rm_live_test_0123456789abcdef',
  day: '2026-10-13',
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  host: 'example.com',
  salt: 'fd5d804a4a60e713ada2bcef694204ccfece37b96dfff60153236f075014f883',
  visitor: '5f9e1bebe31e8bf5',
};

/**
 * A fake fetch. `responses` is a list of statuses (or Errors to throw) consumed in order; the last one repeats.
 */
export function fakeFetch(responses = [202]) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    const r = responses[Math.min(i++, responses.length - 1)];
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (r instanceof Error) throw r;
    return {
      status: r,
      headers: new Headers(),
      text: async () => (r === 202 ? JSON.stringify({ accepted: (calls.at(-1).body.events ?? calls.at(-1).body.samples).length, rejected: [] }) : ''),
    };
  };
  fn.calls = calls;
  return fn;
}

export const fastRetry = { retryDelays: [1, 1], flushInterval: 60_000 };
