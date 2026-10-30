// The settings helpers that decide what a check may do and whom it asks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_NOTARY } from '../extension/lib/default-notary.js';
import { parsePublicKey } from '../extension/lib/notary-signature.js';
import {
  activeEndpoints,
  CONSENT_VERSION,
  DEFAULTS,
  hasConsent,
  validateEndpointUrl,
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

test('a notary address never carries the site: {host} and {port} templates are refused', () => {
  assert.deepEqual(validateEndpointUrl(' https://n.example/v1/cert '), { ok: true, url: 'https://n.example/v1/cert' });
  assert.deepEqual(validateEndpointUrl('http://127.0.0.1:8080/v1/cert'), {
    ok: true,
    url: 'http://127.0.0.1:8080/v1/cert',
  });
  for (const url of [
    'https://n.example/v1/cert?host={host}&port={port}',
    'https://n.example/cert/{host}',
    'https://n.example/v1/cert?port={port}',
    'https://{host}.n.example/v1/cert',
  ]) {
    assert.deepEqual(validateEndpointUrl(url), { ok: false, error: 'endpointErrorTemplate' }, url);
  }
  const error = (url) => validateEndpointUrl(url).error;
  assert.equal(error('http://n.example/v1/cert'), 'endpointErrorHttps');
  assert.equal(error('https://user:secret@n.example/v1/cert'), 'endpointErrorCredentialsInUrl');
  assert.equal(error('https://n.example/v1/cert#top'), 'endpointErrorFragment');
  assert.equal(error('not a url'), 'endpointErrorInvalidUrl');
});

test('the PlusPrivacy notary counts only with signed answers, checked with built-in keys', () => {
  assert.equal(DEFAULT_NOTARY.requireSignature, true);
  assert.ok(Array.isArray(DEFAULT_NOTARY.keys) && Object.isFrozen(DEFAULT_NOTARY.keys));
  for (const key of DEFAULT_NOTARY.keys) {
    assert.ok(parsePublicKey(key), key);
  }
});
