import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';

const problemsOf = (env) => {
  try {
    loadConfig(env);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.problems;
  }
  return [];
};

test('defaults describe a public notary on port 8080', () => {
  const config = loadConfig({});
  assert.equal(config.port, 8080);
  assert.equal(config.host, '0.0.0.0');
  assert.deepEqual([...config.allowedPorts], [443, 8443]);
  assert.deepEqual(config.allowedOrigins, []);
  assert.equal(config.requireOrigin, false);
  assert.equal(config.token, '');
  assert.equal(config.ratePerMinute, 30);
  assert.equal(config.globalPerMinute, 600);
  assert.deepEqual(config.bans, {
    strikes: 5,
    windowMs: 600_000,
    firstMs: 60_000,
    maxMs: 86_400_000,
    alertPerMinute: 300,
  });
  assert.equal(config.cacheMs, 60_000);
  assert.equal(config.timeoutMs, 8000);
  assert.equal(config.trustProxy, false);
  assert.ok(Object.isFrozen(config));
});

test('every bad value is reported at once', () => {
  const problems = problemsOf({
    PORT: 'eighty',
    RATE_LIMIT: '-1',
    ALLOWED_PORTS: '443,70000',
    REQUIRE_ORIGIN: 'maybe',
  });
  assert.equal(problems.length, 4, problems.join('\n'));
  const expected = ['PORT must', 'RATE_LIMIT must', 'ALLOWED_PORTS has', 'REQUIRE_ORIGIN must'];
  assert.deepEqual(
    expected.filter((start) => !problems.some((p) => p.startsWith(start))),
    [],
  );
});

test('origins: extension IDs and web origins, or the older CORS_ORIGIN', () => {
  const id = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  assert.deepEqual(loadConfig({ ALLOWED_ORIGINS: `${id}, https://example.com` }).allowedOrigins, [
    id,
    'https://example.com',
  ]);
  assert.deepEqual(loadConfig({ CORS_ORIGIN: id }).allowedOrigins, [id]);
  assert.deepEqual(loadConfig({ CORS_ORIGIN: '*' }).allowedOrigins, []);
  assert.equal(problemsOf({ ALLOWED_ORIGINS: 'chrome-extension://short' }).length, 1);
  assert.equal(problemsOf({ ALLOWED_ORIGINS: 'https://example.com/path' }).length, 1);
  assert.equal(problemsOf({ ALLOWED_ORIGINS: id, CORS_ORIGIN: id }).length, 1);
});

test('a token must be long enough to resist guessing', () => {
  assert.equal(problemsOf({ NOTARY_TOKEN: 'short' }).length, 1);
  assert.equal(problemsOf({ NOTARY_TOKEN: 'x'.repeat(31) }).length, 1);
  assert.equal(loadConfig({ NOTARY_TOKEN: 'x'.repeat(32) }).token, 'x'.repeat(32));
});

test('TRUST_PROXY takes hops or proxy addresses, never "true"', () => {
  assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(loadConfig({ TRUST_PROXY: '0' }).trustProxy, false);
  assert.equal(loadConfig({ TRUST_PROXY: 'loopback, uniquelocal' }).trustProxy, 'loopback, uniquelocal');
  assert.equal(problemsOf({ TRUST_PROXY: 'true' }).length, 1);
});

test('UPSTREAM_PROXY must be an http:// proxy', () => {
  assert.equal(loadConfig({ UPSTREAM_PROXY: 'http://proxy.internal:3128' }).upstreamProxy.port, '3128');
  assert.equal(problemsOf({ UPSTREAM_PROXY: 'https://proxy.internal' }).length, 1);
  assert.equal(problemsOf({ UPSTREAM_PROXY: 'not a url' }).length, 1);
});
