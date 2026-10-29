// The settings helpers that decide what a check may do and whom it asks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_NOTARY } from '../extension/lib/default-notary.js';
import { activeEndpoints, CONSENT_VERSION, DEFAULTS, hasConsent } from '../extension/lib/settings.js';

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
