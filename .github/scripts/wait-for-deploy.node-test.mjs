import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForDeploy } from './wait-for-deploy.mjs';

const SHA = '7c924501317867ad07c6a8bdcfb08c8dc7197530';
const noSleep = () => Promise.resolve();

/** fetch giả: lần lượt trả các phản hồi cho từng đường dẫn. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const path = new URL(url).pathname;
    const queue = routes[path];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  };
  return { fetchImpl, calls };
}

test('đợi tới khi bản mới (đúng commit) trả lời, rồi DB lên', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '/api/v1/health/live': [
      new Error('ECONNREFUSED'), // đang khởi động lại
      { status: 200, body: { status: 'ok', commit: 'aaaaaaa' } }, // bản cũ
      { status: 200, body: { status: 'ok', commit: '7c92450' } },
    ],
    '/api/v1/health': [{ status: 500, body: {} }, { status: 200, body: { status: 'ok', db: 'up' } }],
  });
  const result = await waitForDeploy({ baseUrl: 'https://api.test', commit: SHA, timeoutMs: 60_000, intervalMs: 1, fetchImpl, sleep: noSleep });
  assert.deepEqual(result, { commit: '7c92450', db: 'up' });
  assert.equal(calls.filter((u) => u.endsWith('/health/live')).length, 3);
});

test('hết giờ mà vẫn là bản cũ thì báo lỗi rõ ràng', async () => {
  const { fetchImpl } = fakeFetch({
    '/api/v1/health/live': [{ status: 200, body: { status: 'ok', commit: 'aaaaaaa' } }],
    '/api/v1/health': [{ status: 200, body: { db: 'up' } }],
  });
  let t = 0;
  await assert.rejects(
    waitForDeploy({ baseUrl: 'https://api.test', commit: SHA, timeoutMs: 50, intervalMs: 10, fetchImpl, sleep: async (ms) => { t += ms; }, now: () => t }),
    /7c92450.*aaaaaaa/,
  );
});

test('commit phải là SHA hợp lệ (tránh so khớp chuỗi rỗng)', async () => {
  await assert.rejects(waitForDeploy({ baseUrl: 'https://api.test', commit: '', fetchImpl: async () => ({}) }), /commit/);
});
