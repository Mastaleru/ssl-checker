import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCertService } from '../src/probe/service.js';

function setup(options = {}) {
  let t = 0;
  const calls = [];
  const deferred = new Map();
  const probe = (host, port) => {
    calls.push(`${host}:${port}`);
    return new Promise((resolve, reject) => deferred.set(`${host}:${port}`, { resolve, reject }));
  };
  const service = createCertService({
    probe,
    cacheMs: 60_000,
    maxConcurrent: 10,
    globalPerMinute: 0,
    now: () => t,
    ...options,
  });
  const answer = (key, value = { chain: [key] }) => deferred.get(key).resolve(value);
  return { service, calls, deferred, answer, advance: (ms) => (t += ms) };
}

test('a second lookup within the cache time is answered from the cache', async () => {
  const { service, calls, answer, advance } = setup();
  const first = service.lookup('example.com', 443);
  answer('example.com:443');
  assert.deepEqual(await first, { value: { chain: ['example.com:443'] }, cached: false });
  assert.equal((await service.lookup('example.com', 443)).cached, true);
  advance(61_000);
  service.lookup('example.com', 443);
  assert.equal(calls.length, 2, 'probed again after the cache time');
});

test('simultaneous lookups of one host share a single probe', async () => {
  const { service, calls, answer } = setup();
  const a = service.lookup('example.com', 443);
  const b = service.lookup('example.com', 443);
  answer('example.com:443');
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(ra.cached, false);
  assert.equal(rb.cached, true);
});

test('too many probes at once: 503 busy', async () => {
  const { service, answer } = setup({ maxConcurrent: 1 });
  const first = service.lookup('a.example', 443);
  await assert.rejects(service.lookup('b.example', 443), { status: 503, code: 'busy' });
  answer('a.example:443');
  await first;
});

test('the global cap counts probes per minute, not cache hits', async () => {
  const { service, answer, advance } = setup({ globalPerMinute: 1 });
  const first = service.lookup('a.example', 443);
  answer('a.example:443');
  await first;
  assert.equal((await service.lookup('a.example', 443)).cached, true);
  await assert.rejects(service.lookup('b.example', 443), (error) => {
    assert.equal(error.code, 'busy');
    assert.equal(error.headers['Retry-After'], '60');
    return true;
  });
  advance(60_000);
  const later = service.lookup('b.example', 443);
  answer('b.example:443');
  assert.equal((await later).cached, false);
});

test('failures are not cached', async () => {
  const { service, calls, deferred } = setup();
  const first = service.lookup('a.example', 443);
  deferred.get('a.example:443').reject(new Error('boom'));
  await assert.rejects(first);
  service.lookup('a.example', 443);
  assert.equal(calls.length, 2);
});
