// Signed answers: what the notary signs, and what a client can check (README.md,
// "Signed answers").
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSigner } from '../src/signing.js';
import {
  EXTENSION_ORIGIN,
  ask,
  fixture,
  get,
  signatureHolds,
  signingKeyFile,
  startNotary,
  startTlsSite,
} from './helpers.js';

let site;
let key;

before(async () => {
  site = await startTlsSite();
  key = signingKeyFile();
});
after(() => {
  site.close();
  key.remove();
});

async function notary(t, env, options) {
  const n = await startNotary(env, options);
  t.after(() => n.close());
  return n;
}

/** The answer as raw bytes, the way a client must check it. */
async function askRaw(base, target, headers = {}) {
  const res = await fetch(`${base}/v1/cert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(target),
  });
  return { res, body: Buffer.from(await res.arrayBuffer()) };
}

const signedEnv = () => ({ SIGNING_KEY_FILE: key.file, ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(site.port) });

test('signs the exact bytes of each answer, which carry the nonce and the key', async (t) => {
  const { base } = await notary(t, signedEnv());
  const nonce = 'nonce-of-this-request_01';
  const { res, body } = await askRaw(base, { host: 'localhost', port: site.port, nonce }, { Origin: EXTENSION_ORIGIN });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('access-control-expose-headers'), 'Notary-Signature');
  const signature = res.headers.get('notary-signature');
  assert.match(signature, /^[A-Za-z0-9_-]{86}$/);
  assert.ok(signatureHolds(key.publicKey, body, signature));

  const answer = JSON.parse(body);
  assert.equal(answer.nonce, nonce);
  assert.equal(answer.key, key.text);
  assert.equal(answer.host, 'localhost');
  assert.equal(answer.port, site.port);

  const altered = Buffer.from(body.toString().replace('"localhost"', '"localhosT"'));
  assert.equal(altered.length, body.length);
  assert.ok(!signatureHolds(key.publicKey, altered, signature), 'one changed letter breaks the signature');
  assert.equal((await get(base, '/v1/health')).body.key, key.text, 'health shows the public key');
});

test('a cached answer is signed again for each nonce', async (t) => {
  const { base, logs } = await notary(t, signedEnv());
  const askWith = (nonce) => askRaw(base, { host: 'localhost', port: site.port, nonce });
  const first = await askWith('first-nonce-0123456789');
  const second = await askWith('second-nonce-012345678');
  assert.ok(
    logs.some((line) => line.msg === 'request' && line.cached),
    'the second answer came from the cache',
  );
  assert.equal(JSON.parse(second.body).nonce, 'second-nonce-012345678');
  assert.equal(JSON.parse(second.body).observedAt, JSON.parse(first.body).observedAt);
  for (const { res, body } of [first, second]) {
    assert.ok(signatureHolds(key.publicKey, body, res.headers.get('notary-signature')));
  }
});

test('a malformed nonce is refused before any site is contacted', async (t) => {
  let probes = 0;
  const probe = async () => {
    probes += 1;
    throw new Error('the site must not be contacted');
  };
  const { base } = await notary(t, { SIGNING_KEY_FILE: key.file, RATE_LIMIT: '0' }, { probe });
  for (const nonce of ['short', 'has spaces in it 0123', 'x'.repeat(129), 'é'.repeat(20), ['a', 'b']]) {
    const { status, body } = await ask(base, { host: 'example.com', nonce });
    assert.equal(status, 400, String(nonce));
    assert.equal(body.error.code, 'badRequest');
  }
  assert.equal(probes, 0);
});

test('without a key, answers carry no signature', async (t) => {
  const { base } = await notary(t, { ALLOW_PRIVATE: '1', ALLOWED_PORTS: String(site.port) });
  const { res, body } = await askRaw(base, { host: 'localhost', port: site.port, nonce: 'unsigned-nonce-0123' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('notary-signature'), null);
  const answer = JSON.parse(body);
  assert.equal(answer.key, null);
  assert.equal(answer.nonce, 'unsigned-nonce-0123');
  const plain = JSON.parse((await askRaw(base, { host: 'localhost', port: site.port })).body);
  assert.equal(plain.nonce, null, 'the nonce is optional');
});

test('only Ed25519 private keys can sign', () => {
  assert.match(createSigner(readFileSync(key.file)).publicKey, /^ed25519:[A-Za-z0-9_-]{43}$/);
  assert.throws(() => createSigner(fixture('localhost.key')), /Ed25519 key is needed, not ec/);
  assert.throws(() => createSigner('not a key'), /not a readable private key/);
});

test('keygen creates a key once, then only prints its public key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notary-keygen-'));
  try {
    const file = join(dir, 'secrets', 'signing-key.pem');
    const keygen = () =>
      execFileSync(process.execPath, [fileURLToPath(new URL('../src/keygen.js', import.meta.url)), file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const created = keygen();
    assert.match(created, /^ed25519:[A-Za-z0-9_-]{43}$/);
    const pem = readFileSync(file, 'utf8');
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600);
    }
    assert.equal(keygen(), created, 'the same key again');
    assert.equal(readFileSync(file, 'utf8'), pem, 'not overwritten');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
