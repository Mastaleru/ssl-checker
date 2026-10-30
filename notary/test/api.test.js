// The notary over HTTP, against a local TLS site.
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { after, before, test } from 'node:test';
import { EXTENSION_ORIGIN, ask, fixture, freePort, get, post, startNotary, startTlsSite } from './helpers.js';

const expectedFingerprint = new X509Certificate(fixture('localhost.crt')).fingerprint256;
let site;
let closedPort;

before(async () => {
  site = await startTlsSite();
  closedPort = await freePort();
});
after(() => site.close());

async function notary(t, env, options) {
  const n = await startNotary(env, options);
  t.after(() => n.close());
  return n;
}

test('reports the chain a site presents, and that it is not trusted', async (t) => {
  const { base } = await notary(t, { ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(site.port) });
  const { status, body, headers } = await ask(base, { host: 'localhost', port: site.port });
  assert.equal(status, 200);
  assert.equal(headers.get('access-control-allow-origin'), '*');
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('x-powered-by'), null);
  assert.equal(body.version, 1);
  assert.equal(body.host, 'localhost');
  assert.equal(body.port, site.port);
  assert.equal(body.vantage, 'Test vantage');
  assert.equal(body.trusted, false);
  assert.match(body.trustError, /SELF_SIGNED|self.signed/i);
  assert.ok(['127.0.0.1', '::1'].includes(body.address));
  assert.match(body.tls.protocol, /^TLSv1\.[23]$/);
  const leaf = new X509Certificate(Buffer.from(body.chain[0], 'base64'));
  assert.equal(leaf.fingerprint256, expectedFingerprint);
});

test('health endpoint and CORS preflight', async (t) => {
  const { base } = await notary(t, {});
  const health = await get(base, '/v1/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, {
    version: 1,
    ok: true,
    vantage: 'Test vantage',
    ports: [443, 8443],
    auth: false,
    key: null,
  });
  const preflight = await fetch(`${base}/v1/cert`, {
    method: 'OPTIONS',
    headers: {
      Origin: EXTENSION_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  const healthPreflight = await fetch(`${base}/v1/health`, {
    method: 'OPTIONS',
    headers: { Origin: EXTENSION_ORIGIN },
  });
  assert.equal(healthPreflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('takes the site only from the body, never from the URL', async (t) => {
  let probes = 0;
  const probe = async () => {
    probes += 1;
    throw new Error('the site must not be contacted');
  };
  const { base } = await notary(t, { RATE_LIMIT: '0' }, { probe });
  for (const method of ['GET', 'HEAD']) {
    const refused = await get(base, '/v1/cert?host=example.com&port=443', {}, method);
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.get('allow'), 'POST, OPTIONS', method);
  }
  const { status, body } = await post(base, '/v1/cert?host=example.com', {});
  assert.equal(status, 400, 'a query string is not read');
  assert.equal(body.error.code, 'badRequest');
  assert.equal(probes, 0);
});

test('refuses a body that is not the expected JSON', async (t) => {
  const { base } = await notary(t, { RATE_LIMIT: '0' });
  const malformed = [
    ['not json', 'application/json'],
    [JSON.stringify(['example.com']), 'application/json'],
    [JSON.stringify({ host: 'example.com' }), 'text/plain'],
    [JSON.stringify({ host: 42 }), 'application/json'],
    [JSON.stringify({ host: 'example.com', port: '443' }), 'application/json'],
    [JSON.stringify({ host: 'example.com', port: 443.5 }), 'application/json'],
    [JSON.stringify({ host: 'example.com', port: null }), 'application/json'],
    [JSON.stringify({ host: 'example.com', nonce: 1234567890123456 }), 'application/json'],
    [JSON.stringify({ host: `${'a'.repeat(2000)}.com` }), 'application/json'],
  ];
  for (const [text, type] of malformed) {
    const { status, body } = await post(base, '/v1/cert', text, { 'Content-Type': type });
    assert.ok(status === 400 || status === 413, `${type} ${text.slice(0, 40)}: ${status}`);
    assert.equal(body.error.code, 'badRequest');
  }
});

test('refuses private and reserved targets (SSRF protection)', async (t) => {
  const { base } = await notary(t, { RATE_LIMIT: '0' });
  const refused = [
    '127.0.0.1',
    'localhost',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '100.64.1.1',
    '[::1]',
    '0.0.0.0',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fd00::1',
    'fe80::1',
    '64:ff9b::7f00:1',
  ];
  for (const host of refused) {
    const { status, body } = await ask(base, { host, port: 443 });
    assert.equal(status, 403, host);
    assert.equal(body.error.code, 'forbiddenTarget', host);
  }
});

test('lets public addresses through (they may still fail without network)', async (t) => {
  const { base } = await notary(t, { TIMEOUT_SECONDS: '1' });
  for (const host of ['1.1.1.1', '2606:4700:4700::1111']) {
    const { body } = await ask(base, { host, port: 443 });
    assert.notEqual(body.error?.code, 'forbiddenTarget', host);
  }
});

test('refuses ports that are not allowed, malformed requests and other methods', async (t) => {
  const { base } = await notary(t, { RATE_LIMIT: '0' });
  const port = await ask(base, { host: 'example.com', port: 22 });
  assert.equal(port.status, 403);
  assert.equal(port.body.error.code, 'forbiddenPort');
  for (const number of [0, 65536]) {
    assert.equal((await ask(base, { host: 'example.com', port: number })).status, 400, String(number));
  }
  for (const host of [undefined, '', 'not a host', `${'a'.repeat(300)}.com`, 'exa_mple.com', 'a..b']) {
    const { status, body } = await ask(base, { host });
    assert.equal(status, 400, JSON.stringify(host));
    assert.equal(body.error.code, 'badRequest');
  }
  const unknown = await get(base, '/elsewhere');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'badRequest');
  const put = await get(base, '/v1/cert', {}, 'PUT');
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'POST, OPTIONS');
  assert.equal(put.body.error.message, 'use POST');
  const healthPost = await get(base, '/v1/health', {}, 'POST');
  assert.equal(healthPost.status, 405);
  assert.equal(healthPost.headers.get('allow'), 'GET, OPTIONS');
});

test('reports connection failures with a code', async (t) => {
  const { base } = await notary(t, { ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(closedPort) });
  const { status, body } = await ask(base, { host: 'localhost', port: closedPort });
  assert.equal(status, 502);
  assert.equal(body.error.code, 'connectFailed');
});

test('only the allowed origins may use the notary from a browser', async (t) => {
  const { base } = await notary(t, { ALLOWED_ORIGINS: EXTENSION_ORIGIN, RATE_LIMIT: '0' });
  const target = { host: '10.0.0.1' };

  const ours = await ask(base, target, { Origin: EXTENSION_ORIGIN });
  assert.equal(ours.body.error.code, 'forbiddenTarget', 'the request reached the target check');
  assert.equal(ours.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN);
  assert.equal(ours.headers.get('vary'), 'Origin');

  const foreign = await ask(base, target, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, 'forbiddenOrigin');
  assert.equal(
    foreign.headers.get('access-control-allow-origin'),
    'https://evil.example',
    'the refusal itself is readable, so the caller learns why',
  );

  const preflight = await fetch(`${base}/v1/cert`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(preflight.status, 403);

  assert.equal((await ask(base, target)).body.error.code, 'forbiddenTarget', 'no Origin (curl) is accepted by default');
});

test('REQUIRE_ORIGIN refuses requests without an Origin, except health checks', async (t) => {
  const { base } = await notary(t, { ALLOWED_ORIGINS: EXTENSION_ORIGIN, REQUIRE_ORIGIN: '1' });
  const bare = await ask(base, { host: '10.0.0.1' });
  assert.equal(bare.status, 403);
  assert.equal(bare.body.error.code, 'forbiddenOrigin');
  assert.equal((await get(base, '/v1/health')).status, 200);
});

test('requires the bearer token when one is configured', async (t) => {
  const token = 'a-long-random-token-for-tests-0123456789';
  const { base } = await notary(t, { NOTARY_TOKEN: token, ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(site.port) });
  const target = { host: 'localhost', port: site.port };
  assert.equal((await ask(base, target)).status, 401);
  assert.equal((await ask(base, target, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await ask(base, target, { Authorization: `Bearer ${token}` })).status, 200);
  assert.equal((await get(base, '/v1/health')).body.auth, true);
});

test('over the rate limit, then banned with growing waits (flood protection)', async (t) => {
  const { base, logs } = await notary(t, { RATE_LIMIT: '2', BAN_STRIKES: '2' });
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const { status, body } = await ask(base, { host: '10.0.0.1' });
    statuses.push(`${status} ${body.error.code}`);
  }
  assert.deepEqual(statuses, ['403 forbiddenTarget', '403 forbiddenTarget', '429 rateLimited', '429 rateLimited']);
  const banned = await ask(base, { host: '10.0.0.1' });
  assert.equal(banned.status, 429);
  assert.equal(banned.body.error.message, 'temporarily blocked after repeated abuse');
  assert.equal(banned.headers.get('retry-after'), '60');
  assert.equal(banned.headers.get('access-control-allow-origin'), '*', 'the extension can still read the error');
  const ban = logs.find((line) => line.msg === 'client banned');
  assert.equal(ban.reason, 'rate');
  assert.equal(ban.client, '127.0.0.1');
});

test('guessing tokens gets the client banned (brute-force protection)', async (t) => {
  const token = 'a-long-random-token-for-tests-0123456789';
  const { base } = await notary(t, { NOTARY_TOKEN: token, BAN_STRIKES: '3', RATE_LIMIT: '0' });
  for (let i = 0; i < 3; i++) {
    assert.equal((await ask(base, { host: '10.0.0.1' }, { Authorization: `Bearer guess-${i}` })).status, 401);
  }
  const right = await ask(base, { host: '10.0.0.1' }, { Authorization: `Bearer ${token}` });
  assert.equal(right.status, 429, 'even the right token waits out the ban');
});

test('X-Forwarded-For counts only when TRUST_PROXY says a proxy is in front', async (t) => {
  const proxied = await notary(t, { TRUST_PROXY: '1', RATE_LIMIT: '1' });
  const via = (base, address) => ask(base, { host: '10.0.0.1' }, { 'X-Forwarded-For': address });
  assert.equal((await via(proxied.base, '198.51.100.1')).status, 403);
  assert.equal((await via(proxied.base, '198.51.100.1')).status, 429);
  assert.equal((await via(proxied.base, '198.51.100.2')).status, 403, 'another client has its own limit');
  assert.equal((await via(proxied.base, '2001:db8:1:2::1')).status, 403);
  assert.equal((await via(proxied.base, '2001:db8:1:2::ffff')).status, 429, 'one IPv6 /64 is one client');
  // Only the last entry, the one the proxy added, is used.
  assert.equal((await via(proxied.base, '203.0.113.9, 198.51.100.1')).status, 429);
});

test('logs requests without hosts, unless LOG_HOSTS=1', async (t) => {
  const quiet = await notary(t, { RATE_LIMIT: '0' });
  await ask(quiet.base, { host: '10.0.0.1' });
  const line = quiet.logs.find((l) => l.msg === 'request');
  assert.equal(line.path, '/v1/cert');
  assert.equal(line.status, 403);
  assert.equal(line.target, undefined);
  assert.ok(!JSON.stringify(quiet.logs).includes('10.0.0.1'));

  const verbose = await notary(t, { RATE_LIMIT: '0', LOG_HOSTS: '1' });
  await ask(verbose.base, { host: '10.0.0.1' });
  assert.equal(verbose.logs.find((l) => l.msg === 'request').target, '10.0.0.1:443');
});
