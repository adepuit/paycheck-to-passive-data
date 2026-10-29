import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from './fetch-dividends.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const res = (status) => ({ ok: false, status, json: async () => ({}) });
const recorder = () => { const calls = []; return { calls, sleep: async (ms) => { calls.push(ms); } }; };

test('fetchAllPages follows next_url with apiKey, sleeps 13s between pages, passes a timeout signal', async () => {
  const urls = []; const opts = [];
  const pages = [
    ok({ results: [1, 2], next_url: 'https://api.polygon.io/v3/x?cursor=abc' }),
    ok({ results: [3] }),
  ];
  const s = recorder();
  const out = await fetchAllPages('https://api.polygon.io/v3/x?limit=1000', { token: 'K', fetchImpl: async (u, o) => { urls.push(u); opts.push(o); return pages.shift(); }, sleep: s.sleep });
  assert.deepEqual(out, [1, 2, 3]);
  assert.ok(opts.every((o) => o && o.signal instanceof AbortSignal));
  assert.deepEqual(urls, ['https://api.polygon.io/v3/x?limit=1000&apiKey=K', 'https://api.polygon.io/v3/x?cursor=abc&apiKey=K']);
  assert.deepEqual(s.calls, [13000]);
});

test('fetchAllPages retries 429/5xx/network up to 3 attempts with 60s waits', async () => {
  const seq = [res(429), Promise.reject(new Error('ECONNRESET')), ok({ results: ['a'] })];
  const s = recorder();
  const out = await fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'K', fetchImpl: async () => seq.shift(), sleep: s.sleep });
  assert.deepEqual(out, ['a']);
  assert.deepEqual(s.calls, [60000, 60000]);
  const s2 = recorder();
  await assert.rejects(
    fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'SECRET', fetchImpl: async () => res(503), sleep: s2.sleep }),
    (e) => /503/.test(e.message) && /\/v3\/x/.test(e.message) && !/SECRET/.test(e.message));
  assert.deepEqual(s2.calls, [60000, 60000]);
});

test('fetchAllPages throws on non-retryable status, bad shape, or page cap; never leaks the key', async () => {
  const s = recorder();
  await assert.rejects(fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'SECRET', fetchImpl: async () => res(403), sleep: s.sleep }),
    (e) => /403/.test(e.message) && !/SECRET/.test(e.message));
  assert.deepEqual(s.calls, []); // no retry on 403
  await assert.rejects(fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'K', fetchImpl: async () => ok({ status: 'ERROR' }), sleep: s.sleep }), /shape/);
  const loop = async () => ok({ results: [1], next_url: 'https://api.polygon.io/v3/x?cursor=n' });
  await assert.rejects(fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'K', fetchImpl: loop, sleep: s.sleep, maxPages: 3 }), /page cap/);
});
