import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeChain } from '../extension/lib/x509.js';
import {
  assess,
  describe,
  isPublicConnection,
  learn,
  normalizeOrganization,
  observationFrom,
  recordsToPrune,
} from '../extension/lib/site-memory.js';

const TLS = new URL('./fixtures/tls/', import.meta.url);
const pemChain = (file) =>
  [...readFileSync(new URL(file, TLS), 'utf8').matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END/g)].map((m) => m[1].replace(/\s+/g, ''));
const site = { host: 'www.example.com', port: 443 };
const local = (chain, ct) => ({ chain, security: { certificateTransparencyCompliance: ct } });

const genuine = await describeChain(pemChain('site-chain.pem'));
const intercepted = await describeChain(pemChain('intercept-chain.pem'));

/** A synthetic observation, for the cases that need many CAs or exact times. */
const obs = (key, { issuerKey = `${key}-k1`, pub = true, at = '2026-10-01T00:00:00.000Z' } = {}) => ({
  key: `o:${key}`,
  label: `${key} CA`,
  public: pub,
  issuerKey,
  at,
});

test('normalizeOrganization folds legal suffixes, punctuation and case', () => {
  assert.equal(normalizeOrganization("Let's Encrypt"), 'lets encrypt');
  assert.equal(normalizeOrganization('Google Trust Services LLC'), normalizeOrganization('Google Trust Services'));
  assert.equal(normalizeOrganization('DigiCert, Inc.'), normalizeOrganization('DigiCert Inc'));
  assert.equal(normalizeOrganization('GlobalSign nv-sa'), 'globalsign');
  assert.equal(normalizeOrganization('Exemplu S.R.L.'), 'exemplu');
  assert.equal(normalizeOrganization('Microsoft Corporation'), 'microsoft');
  assert.equal(normalizeOrganization('Inc.'), 'inc');
  assert.equal(normalizeOrganization(null), '');
});

test('observationFrom identifies the CA by organization and the issuing key', () => {
  const o = observationFrom(local(genuine, 'compliant'), '2026-10-26T10:00:00.000Z');
  assert.equal(o.key, 'o:ssl checker test pki');
  assert.equal(o.label, 'SSL Checker Test Issuing CA (SSL Checker Test PKI)');
  assert.equal(o.issuerKey, genuine[1].fingerprints.spkiSha256);
  assert.equal(o.public, true);
  assert.equal(observationFrom(local(genuine, 'unknown'), o.at).public, false);
  assert.equal(isPublicConnection(local(genuine, 'not-compliant')), false);

  const noOrg = [{ ...genuine[0], issuer: { organization: null, commonName: 'mitmproxy', dn: 'CN=mitmproxy' } }];
  assert.equal(observationFrom(local(noOrg, 'unknown'), o.at).key, 'cn:mitmproxy');
  // A self-signed leaf is its own issuer.
  assert.equal(observationFrom(local(noOrg, 'unknown'), o.at).issuerKey, genuine[0].fingerprints.spkiSha256);
});

test('first check, then the same CA again', () => {
  const o = observationFrom(local(genuine, 'compliant'), '2026-10-01T00:00:00.000Z');
  assert.deepEqual(assess(null, o), { status: 'first', autoLearn: true });
  const record = learn(null, o, site);
  assert.equal(record.host, 'www.example.com');
  assert.equal(record.cas.length, 1);
  assert.equal(record.cas[0].count, 1);
  assert.equal(assess(record, { ...o, at: '2026-10-02T00:00:00.000Z' }).status, 'known');
  const again = learn(record, { ...o, at: '2026-10-02T00:00:00.000Z' }, site);
  assert.equal(again.cas[0].count, 2);
  assert.equal(again.cas[0].firstSeen, '2026-10-01T00:00:00.000Z');
  assert.equal(again.cas[0].lastSeen, '2026-10-02T00:00:00.000Z');
  assert.equal(record.cas[0].count, 1, 'learn does not mutate its input');
});

test('a public interceptor-free site switching to an unlogged certificate raises publicToPrivate', () => {
  const record = learn(null, observationFrom(local(genuine, 'compliant'), '2026-10-01T00:00:00.000Z'), site);
  const now = observationFrom(local(intercepted, 'unknown'), '2026-10-26T00:00:00.000Z');
  const a = assess(record, now);
  assert.equal(a.status, 'changed');
  assert.equal(a.kind, 'publicToPrivate');
  assert.equal(a.sameName, false);
  assert.equal(a.autoLearn, false);
  assert.equal(a.previous.label, 'SSL Checker Test Issuing CA (SSL Checker Test PKI)');
});

test('the direction of a change decides whether it is learned', () => {
  const pub = learn(null, obs('alpha'), site);
  const priv = learn(null, obs('corp', { pub: false }), site);
  assert.deepEqual([assess(pub, obs('beta')).kind, assess(pub, obs('beta')).autoLearn], ['publicToPublic', true]);
  assert.deepEqual([assess(priv, obs('beta')).kind, assess(priv, obs('beta')).autoLearn], ['privateToPublic', true]);
  assert.deepEqual([assess(pub, obs('evil', { pub: false })).kind, assess(pub, obs('evil', { pub: false })).autoLearn], ['publicToPrivate', false]);
  assert.deepEqual([assess(priv, obs('evil', { pub: false })).kind, assess(priv, obs('evil', { pub: false })).autoLearn], ['privateToPrivate', false]);
});

test('a borrowed CA name with an unknown key is a change unless the certificate is public', () => {
  const record = learn(null, obs('lets encrypt'), site);
  const lookAlike = obs('lets encrypt', { issuerKey: 'attacker-key', pub: false });
  const a = assess(record, lookAlike);
  assert.equal(a.status, 'changed');
  assert.equal(a.kind, 'publicToPrivate');
  assert.equal(a.sameName, true);
  // A new intermediate of the same CA that is publicly logged is simply learned.
  const rotated = obs('lets encrypt', { issuerKey: 'R13-key', pub: true });
  assert.equal(assess(record, rotated).status, 'known');
  assert.deepEqual(learn(record, rotated, site).cas[0].issuerKeys, ['lets encrypt-k1', 'R13-key']);
  // A private CA that was never public stays privateToPrivate.
  const corp = learn(null, obs('corp', { pub: false }), site);
  assert.equal(assess(corp, obs('corp', { issuerKey: 'other', pub: false })).kind, 'privateToPrivate');
});

test('previous points at the most recent public CA when there was one', () => {
  let record = learn(null, obs('old', { at: '2026-01-01T00:00:00.000Z' }), site);
  record = learn(record, obs('corp', { pub: false, at: '2026-09-01T00:00:00.000Z' }), site);
  record = learn(record, obs('new', { at: '2026-06-01T00:00:00.000Z' }), site);
  const a = assess(record, obs('evil', { pub: false }));
  assert.equal(a.kind, 'publicToPrivate');
  assert.equal(a.previous.key, 'o:new');
});

test('learn keeps public sticky and bounds what it stores', () => {
  let record = learn(null, obs('ca', { pub: true }), site);
  record = learn(record, obs('ca', { pub: false }), site);
  assert.equal(record.cas[0].public, true);
  for (let i = 0; i < 12; i++) record = learn(record, obs('ca', { issuerKey: `k${i}` }), site);
  assert.equal(record.cas[0].issuerKeys.length, 8);
  assert.equal(record.cas[0].issuerKeys.at(-1), 'k11');
  for (let i = 0; i < 12; i++) record = learn(record, obs(`ca${i}`, { at: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00.000Z` }), site);
  assert.equal(record.cas.length, 10);
  assert.ok(record.cas.some((ca) => ca.key === 'o:ca11'));
});

test('describe gives the popup what it shows', () => {
  const first = learn(null, obs('alpha'), site);
  const d = describe(assess(null, obs('alpha')), first, obs('alpha'));
  assert.equal(d.status, 'first');
  assert.equal(d.learned, true);
  assert.equal(d.entry.count, 1);
  assert.deepEqual(d.current, { label: 'alpha CA', public: true });

  const changed = describe(assess(first, obs('evil', { pub: false })), first, obs('evil', { pub: false }));
  assert.equal(changed.status, 'changed');
  assert.equal(changed.kind, 'publicToPrivate');
  assert.equal(changed.learned, false);
  assert.equal(changed.entry, null);
  assert.equal(changed.previous.label, 'alpha CA');
});

test('recordsToPrune drops stale records, then the oldest beyond the limit', () => {
  const now = Date.parse('2026-10-26T00:00:00.000Z');
  const entries = [
    { key: 'a', lastSeen: '2026-10-25T00:00:00.000Z' },
    { key: 'b', lastSeen: '2024-01-01T00:00:00.000Z' },
    { key: 'c', lastSeen: '2026-10-20T00:00:00.000Z' },
    { key: 'd', lastSeen: '2026-10-01T00:00:00.000Z' },
    { key: 'e', lastSeen: '' },
  ];
  assert.deepEqual(recordsToPrune(entries, now).sort(), ['b', 'e']);
  assert.deepEqual(recordsToPrune(entries, now, { maxSites: 2 }).sort(), ['b', 'd', 'e']);
});
