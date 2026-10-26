// Integration tests for notary/server.mjs: starts the real server as a child
// process plus a local TLS server to look at.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer as createTlsServer } from 'node:tls';
import { createServer as createNetServer } from 'node:net';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../notary/server.mjs', import.meta.url));
const key = readFileSync(new URL('./fixtures/tls/localhost.key', import.meta.url));
const cert = readFileSync(new URL('./fixtures/tls/localhost.crt', import.meta.url));
const expectedFingerprint = new X509Certificate(cert).fingerprint256.replace(/:/g, '').toLowerCase();

const children = [];
let target;
let targetPort;
let closedPort;

function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startNotary(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [serverPath], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', NOTARY_NAME: 'Test vantage', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
    child.once('exit', (code) => reject(new Error(`notary exited with ${code}`)));
  });
  return `http://127.0.0.1:${port}`;
}

async function get(base, path, headers = {}) {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

before(async () => {
  target = createTlsServer({ key, cert }, (socket) => socket.end());
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetPort = target.address().port;
  closedPort = await freePort();
});

after(() => {
  for (const child of children) {
    child.kill();
  }
  target.close();
});

test('reports the chain a server presents, and that it is not trusted', async () => {
  const base = await startNotary({ ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(targetPort) });
  const { status, body, headers } = await get(base, `/v1/cert?host=localhost&port=${targetPort}`);
  assert.equal(status, 200);
  assert.equal(headers.get('access-control-allow-origin'), '*');
  assert.equal(body.version, 1);
  assert.equal(body.vantage, 'Test vantage');
  assert.equal(body.trusted, false);
  assert.match(body.trustError, /SELF_SIGNED|self.signed/i);
  assert.ok(['127.0.0.1', '::1'].includes(body.address));
  const leaf = new X509Certificate(Buffer.from(body.chain[0], 'base64'));
  assert.equal(leaf.fingerprint256.replace(/:/g, '').toLowerCase(), expectedFingerprint);
  assert.match(body.tls.protocol, /^TLSv1\.[23]$/);
});

test('health endpoint and CORS preflight', async () => {
  const base = await startNotary({ ALLOWED_PORTS: '443,8443' });
  const health = await get(base, '/v1/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.ports, [443, 8443]);
  const preflight = await fetch(`${base}/v1/cert`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Authorization');
});

test('refuses private and reserved targets (SSRF protection)', async () => {
  const base = await startNotary({ ALLOWED_PORTS: `443,${targetPort}` });
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
    const { status, body } = await get(base, `/v1/cert?host=${encodeURIComponent(host)}&port=443`);
    assert.equal(status, 403, host);
    assert.equal(body.error.code, 'forbiddenTarget', host);
  }
});

test('lets public addresses through (they may still fail without network)', async () => {
  const base = await startNotary({ ALLOWED_PORTS: '443' });
  for (const host of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    const { body } = await get(base, `/v1/cert?host=${encodeURIComponent(host)}&port=443`);
    assert.notEqual(body.error && body.error.code, 'forbiddenTarget', host);
  }
});

test('refuses ports that are not allowed and malformed hosts', async () => {
  const base = await startNotary({ ALLOWED_PORTS: '443' });
  const port = await get(base, '/v1/cert?host=example.com&port=22');
  assert.equal(port.status, 403);
  assert.equal(port.body.error.code, 'forbiddenPort');
  for (const host of ['', 'not a host', 'a'.repeat(300) + '.com', 'exa_mple.com', 'a..b']) {
    const { status, body } = await get(base, `/v1/cert?host=${encodeURIComponent(host)}`);
    assert.equal(status, 400, JSON.stringify(host));
    assert.equal(body.error.code, 'badRequest');
  }
  assert.equal((await get(base, '/elsewhere')).status, 404);
});

test('requires the bearer token when one is configured', async () => {
  const base = await startNotary({
    NOTARY_TOKEN: 's3cret-token',
    ALLOW_PRIVATE: '1',
    ALLOWED_PORTS: String(targetPort),
  });
  const path = `/v1/cert?host=localhost&port=${targetPort}`;
  assert.equal((await get(base, path)).status, 401);
  assert.equal((await get(base, path, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await get(base, path, { Authorization: 'Bearer s3cret-token' })).status, 200);
});

test('rate limits per client', async () => {
  const base = await startNotary({ RATE_LIMIT: '2', ALLOWED_PORTS: '443' });
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    statuses.push((await get(base, '/v1/cert?host=10.0.0.1')).status);
  }
  assert.deepEqual(statuses, [403, 403, 429]);
});

test('reports connection failures with a code', async () => {
  const base = await startNotary({ ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(closedPort) });
  const { status, body } = await get(base, `/v1/cert?host=localhost&port=${closedPort}`);
  assert.equal(status, 502);
  assert.equal(body.error.code, 'connectFailed');
});
