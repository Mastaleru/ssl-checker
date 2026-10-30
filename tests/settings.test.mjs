// The settings helpers that decide what a check may do and whom it asks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_NOTARY } from '../extension/lib/default-notary.js';
import { parsePublicKey } from '../extension/lib/notary-signature.js';
import {
  activeEndpoints,
  buildNotaryRequest,
  CONSENT_VERSION,
  DEFAULTS,
  hasConsent,
  targetCanBeChecked,
} from '../extension/lib/settings.js';

const own = (id, enabled = true) => ({ id, name: id, url: `https://${id}.example/v1/cert`, enabled });

test('nothing is checked before the user agrees to the current disclosure', () => {
  assert.equal(hasConsent({ ...DEFAULTS }), false);
  assert.equal(hasConsent({ consent: { version: CONSENT_VERSION, at: '2026-10-29T12:00:00Z' } }), true);
  assert.equal(hasConsent({ consent: { version: CONSENT_VERSION - 1, at: '2026-01-01T00:00:00Z' } }), false);
});

test('the PlusPrivacy notary is on by default and asked first', () => {
  assert.equal(DEFAULTS.defaultNotary, true);
  const settings = { ...DEFAULTS, endpoints: [own('a'), own('b', false), own('c')] };
  assert.deepEqual(
    activeEndpoints(settings).map((e) => e.id),
    ['plusprivacy', 'a', 'c'],
  );
  assert.deepEqual(
    activeEndpoints({ ...settings, defaultNotary: false }).map((e) => e.id),
    ['a', 'c'],
  );
});

test('the PlusPrivacy notary is reached over HTTPS, without a token', () => {
  const url = new URL(DEFAULT_NOTARY.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.host, 'notary.plusprivacy.com');
  assert.equal(DEFAULT_NOTARY.token, undefined);
  assert.ok(Object.isFrozen(DEFAULT_NOTARY));
});

test('a notary gets the site in a POST body, or in the URL only when its address is a template', () => {
  const build = (url) => buildNotaryRequest(url, 'example.com', 8443);
  const post = (url) => ({ method: 'POST', url, target: { host: 'example.com', port: 8443 } });
  // No {host}: a POST, and the site's name stays out of the URL.
  assert.deepEqual(build('https://n.example/v1/cert'), post('https://n.example/v1/cert'));
  assert.deepEqual(build('https://n.example/v1/cert?key=abc'), post('https://n.example/v1/cert?key=abc'));
  assert.deepEqual(build('https://n.example/check?site={host}:{port}'), {
    method: 'GET',
    url: 'https://n.example/check?site=example.com:8443',
  });
  // Without {port}, the port is added, so that the notary does not fall back to 443.
  assert.deepEqual(build('https://n.example/v1/cert?host={host}'), {
    method: 'GET',
    url: 'https://n.example/v1/cert?host=example.com&port=8443',
  });
  assert.deepEqual(build('https://n.example/cert/{host}'), {
    method: 'GET',
    url: 'https://n.example/cert/example.com?port=8443',
  });
  // A source with a key must be asked in a way its signed answer can be checked against.
  assert.equal(targetCanBeChecked('https://n.example/v1/cert'), true);
  assert.equal(targetCanBeChecked('https://n.example/v1/cert?host={host}&port={port}'), true);
  assert.equal(targetCanBeChecked('https://n.example/cert/{host}'), false);
  assert.equal(targetCanBeChecked('not a url'), false);
});

test('the PlusPrivacy notary counts only with signed answers, checked with built-in keys', () => {
  assert.equal(DEFAULT_NOTARY.requireSignature, true);
  assert.ok(Array.isArray(DEFAULT_NOTARY.keys) && Object.isFrozen(DEFAULT_NOTARY.keys));
  for (const key of DEFAULT_NOTARY.keys) {
    assert.ok(parsePublicKey(key), key);
  }
});
