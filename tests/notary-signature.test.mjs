// The extension's check of signed notary answers, against answers signed by the
// notary's own code (notary/src/signing.js).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { checkSignature, newNonce, parseKeyList, parsePublicKey } from '../extension/lib/notary-signature.js';
import { createSigner } from '../notary/src/signing.js';

const newSigner = () =>
  createSigner(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
const notary = newSigner();
const other = newSigner();
const NONCE = 'Xq3MpTb0vR9kLs2eWn5yZA';

/** An answer as the notary sends it: the body's bytes and the Notary-Signature header. */
function signedAnswer(fields = {}, signer = notary) {
  const answer = {
    version: 1,
    host: 'example.com',
    port: 443,
    observedAt: '2026-10-29T15:00:00.000Z',
    chain: ['MIIBsite', 'MIIBintermediate'],
    nonce: NONCE,
    key: signer.publicKey,
    ...fields,
  };
  const body = Buffer.from(JSON.stringify(answer));
  return { body: new Uint8Array(body), signature: signer.sign(body), answer };
}

const check = ({ body, signature, answer }, options = {}) =>
  checkSignature({
    body,
    signature,
    answer: options.answer || answer,
    keys: [notary.publicKey],
    nonce: NONCE,
    host: 'example.com',
    port: 443,
    ...options,
  });

test('an answer signed with a known key, for this request, is verified', async () => {
  assert.deepEqual(await check(signedAnswer()), { status: 'verified', key: notary.publicKey });
  assert.equal((await check(signedAnswer(), { keys: [other.publicKey, notary.publicKey] })).status, 'verified');
  // The notary lower-cases host names, writes them in ASCII and drops a final dot and IPv6 brackets.
  assert.equal((await check(signedAnswer(), { host: 'Example.COM.' })).status, 'verified');
  const idn = signedAnswer({ host: 'xn--bcher-kva.example' });
  assert.equal((await check(idn, { host: 'bücher.example' })).status, 'verified');
  const v6 = signedAnswer({ host: '2001:db8::1' });
  assert.equal((await check(v6, { host: '[2001:DB8::1]' })).status, 'verified');
});

test('a changed byte, a replayed answer or another target is tampering', async () => {
  const original = signedAnswer();
  const forged = Buffer.from(Buffer.from(original.body).toString().replace('MIIBsite', 'MIIBfake'));
  assert.deepEqual(await check({ ...original, body: new Uint8Array(forged) }), {
    status: 'tampered',
    reason: 'signature',
  });
  assert.deepEqual(await check(original, { nonce: newNonce() }), { status: 'tampered', reason: 'nonce' });
  assert.deepEqual(await check(original, { host: 'example.net' }), { status: 'tampered', reason: 'target' });
  assert.deepEqual(await check(original, { port: 8443 }), { status: 'tampered', reason: 'target' });
  // A signature by another key over an answer that names the known key.
  const swapped = signedAnswer({ key: notary.publicKey }, other);
  assert.equal((await check(swapped)).status, 'tampered');
});

test('a missing or malformed signature, or an unknown key, is not accepted either', async () => {
  const answer = signedAnswer();
  assert.deepEqual(await check({ ...answer, signature: null }), { status: 'unsigned' });
  assert.deepEqual(await check({ ...answer, signature: 'not a signature' }), { status: 'unsigned' });
  assert.deepEqual(await check({ ...answer, signature: `${answer.signature}AA` }), { status: 'unsigned' });
  const elsewhere = signedAnswer({}, other);
  assert.deepEqual(await check(elsewhere), { status: 'unknownKey', key: other.publicKey });
});

test('a failure of Web Crypto itself is not taken for tampering', async () => {
  crypto.subtle.importKey = async () => {
    throw new Error('Ed25519 is not supported');
  };
  try {
    assert.deepEqual(await check(signedAnswer()), { status: 'cannotVerify' });
  } finally {
    delete crypto.subtle.importKey;
  }
  assert.equal((await check(signedAnswer())).status, 'verified');
});

test('with no key known, a signature only says who claims to have signed', async () => {
  const answer = signedAnswer();
  assert.deepEqual(await check(answer, { keys: [] }), { status: 'selfSigned', key: notary.publicKey });
  const forged = new Uint8Array(Buffer.from(Buffer.from(answer.body).toString().replace('MIIBsite', 'MIIBfake')));
  assert.deepEqual(await check({ ...answer, body: forged }, { keys: [] }), { status: 'unsigned' });
  assert.deepEqual(await check({ ...answer, signature: null }, { keys: [] }), { status: 'unsigned' });
});

test('public keys are read only in the form the notary prints', () => {
  assert.equal(parsePublicKey(notary.publicKey).length, 32);
  assert.equal(parsePublicKey(` ${notary.publicKey} `).length, 32);
  const body = notary.publicKey.slice('ed25519:'.length);
  for (const bad of [body, `ed448:${body}`, `ed25519:${body}A`, `ed25519:${body.slice(1)}`, 'ed25519:', null]) {
    assert.equal(parsePublicKey(bad), null, String(bad));
  }
  // The last character carries two unused bits: setting one gives the same 32 bytes,
  // but only the spelling the notary prints is accepted.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const variant = `ed25519:${body.slice(0, -1)}${alphabet[alphabet.indexOf(body.at(-1)) + 1]}`;
  assert.equal(parsePublicKey(variant), null);
});

test('the Options field takes one or more keys, separated by spaces or commas', () => {
  assert.deepEqual(parseKeyList(''), { ok: true, keys: [] });
  assert.deepEqual(parseKeyList(`${notary.publicKey}, ${other.publicKey}\n${notary.publicKey}`), {
    ok: true,
    keys: [notary.publicKey, other.publicKey],
  });
  assert.deepEqual(parseKeyList(`${notary.publicKey} ed25519:short`), { ok: false });
});

test('every request gets a new 16-byte nonce', () => {
  const nonces = new Set(Array.from({ length: 100 }, newNonce));
  assert.equal(nonces.size, 100);
  for (const nonce of nonces) {
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
  }
});
