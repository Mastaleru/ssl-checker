import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLeaves, computeVerdict, RELATION } from '../extension/lib/verdict.js';
import { certificateCoversHost, isInternalHost, parseTarget } from '../extension/lib/hostnames.js';
import { identifyInterceptor } from '../extension/lib/interceptors.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

function cert({
  fp = 'aa',
  spki = 'k1',
  issuerO = 'Public CA Inc',
  issuerCN = 'Public CA R1',
  aki = 'a1',
  dns = ['example.com'],
  days = 60,
  selfIssued = false,
  sig = false,
  rsaBits = null,
} = {}) {
  return {
    fingerprints: { sha256: fp.padEnd(64, '0'), sha1: '', spkiSha256: spki },
    issuer: {
      raw: `${issuerO}/${issuerCN}`,
      organization: issuerO,
      commonName: issuerCN,
      dn: `CN=${issuerCN}, O=${issuerO}`,
    },
    subject: { commonName: dns[0], organization: null, dn: `CN=${dns[0]}` },
    notBefore: new Date(NOW - 30 * DAY).toISOString(),
    notAfter: new Date(NOW + days * DAY).toISOString(),
    extensions: {
      authorityKeyId: aki,
      subjectAltName: { dns, ip: [], email: [], uri: [], directoryName: [], other: 0 },
    },
    signatureAlgorithm: { weak: sig },
    publicKey: rsaBits ? { algorithm: 'RSA', bits: rsaBits } : { algorithm: 'EC', bits: 256 },
    selfIssued,
  };
}
const local = (leaf, ct = 'compliant', protocol = 'TLS 1.3') => ({
  chain: [leaf],
  security: { certificateTransparencyCompliance: ct, protocol },
});
const notary = (id, leaf, extra = {}) => ({ id, state: 'ok', chain: [leaf], ...extra });
const https = { secure: true, host: 'example.com', port: 443 };
const verdict = (input) => computeVerdict({ target: https, now: NOW, ...input });

test('compareLeaves ranks the relation', () => {
  const a = cert();
  assert.equal(compareLeaves(a, cert()), RELATION.SAME_CERTIFICATE);
  assert.equal(compareLeaves(a, cert({ fp: 'bb' })), RELATION.SAME_KEY);
  assert.equal(compareLeaves(a, cert({ fp: 'bb', spki: 'k2' })), RELATION.SAME_ISSUER);
  assert.equal(compareLeaves(a, cert({ fp: 'bb', spki: 'k2', issuerCN: 'Public CA E1', aki: 'a9' })), RELATION.SAME_CA);
  assert.equal(
    compareLeaves(a, cert({ fp: 'bb', spki: 'k2', issuerO: 'Other CA', issuerCN: 'X', aki: 'a9' })),
    RELATION.DIFFERENT,
  );
});

test('identical certificate seen by notaries → confirmed', () => {
  const v = verdict({ local: local(cert()), notaries: [notary('n1', cert()), notary('n2', cert({ fp: 'bb' }))] });
  assert.equal(v.code, 'confirmed');
  assert.equal(v.level, 'ok');
  assert.equal(v.counts.consistent, 2);
});

test('different certificate and not publicly logged → intercepted', () => {
  const mitm = cert({ fp: 'ff', spki: 'evil', issuerO: 'Acme Corp', issuerCN: 'Acme Inspection CA', aki: 'zz' });
  const v = verdict({ local: local(mitm, 'not-compliant'), notaries: [notary('n1', cert())] });
  assert.equal(v.code, 'intercepted');
  assert.equal(v.level, 'danger');
  assert.equal(v.localIssuer, 'Acme Inspection CA (Acme Corp)');
  assert.equal(v.externalIssuer, 'Public CA R1 (Public CA Inc)');
  assert.equal(v.interceptor, null);
});

test('a known product is named, even with CT unknown', () => {
  const mitm = cert({
    fp: 'ff',
    spki: 'evil',
    issuerO: 'Zscaler Inc.',
    issuerCN: 'Zscaler Intermediate Root CA',
    aki: 'zz',
  });
  const v = verdict({ local: local(mitm, 'unknown'), notaries: [notary('n1', cert())] });
  assert.equal(v.code, 'intercepted');
  assert.equal(v.interceptor.name, 'Zscaler');
  const alone = verdict({ local: local(mitm, 'not-compliant'), notaries: [] });
  assert.equal(alone.code, 'interceptorDetected');
  assert.equal(alone.level, 'danger');
});

test('a publicly logged certificate is never labelled as an interceptor', () => {
  const leaf = cert({ issuerO: 'Sophos Ltd', issuerCN: 'Sophos Public CA' });
  const v = verdict({ local: local(leaf, 'compliant'), notaries: [] });
  assert.equal(v.code, 'publicLocalOnly');
  assert.equal(v.interceptor, null);
});

test('local-only outcomes depend on Certificate Transparency', () => {
  assert.equal(verdict({ local: local(cert(), 'compliant') }).code, 'publicLocalOnly');
  assert.equal(verdict({ local: local(cert(), 'not-compliant') }).code, 'privateCa');
  // Chromium reports "unknown" for certificates chaining to locally installed roots.
  const unknown = verdict({ local: local(cert(), 'unknown') });
  assert.equal(unknown.code, 'privateCa');
  assert.equal(unknown.level, 'warn');
});

test('all sources differ: public certificate → warning, otherwise → likely intercepted', () => {
  const other = cert({ fp: 'cc', spki: 'k3', issuerO: 'Another CA', issuerCN: 'Another R3', aki: 'q' });
  assert.equal(
    verdict({ local: local(cert(), 'compliant'), notaries: [notary('n', other)] }).code,
    'conflictingPublic',
  );
  const v = verdict({ local: local(cert(), 'unknown'), notaries: [notary('n', other)] });
  assert.equal(v.code, 'intercepted');
  assert.equal(v.level, 'danger');
});

test('mixed answers (the sandbox scenario: one notary shares the intercepted network)', () => {
  const genuine = cert({
    fp: '15',
    spki: 'gs',
    issuerO: 'GlobalSign nv-sa',
    issuerCN: 'GlobalSign Atlas R3 DV TLS CA 2025 Q4',
    aki: 'g1',
  });
  const gateway = cert({
    fp: 'e1',
    spki: 'gw',
    issuerO: 'Anthropic',
    issuerCN: 'Egress Gateway SDS Issuing CA (production)',
    aki: 'e9',
  });
  const notaries = [notary('proxy', genuine), notary('direct', gateway)];

  // Browser holds the public certificate, confirmed by CT: the odd notary is the problem.
  const ok = verdict({ local: local(genuine, 'compliant'), notaries });
  assert.equal(ok.code, 'confirmed');
  assert.equal(ok.level, 'ok');
  assert.deepEqual(ok.warnings.find((w) => w.code === 'someSourcesDiffer').ids, ['direct']);

  // Without CT confirmation nobody can tell which side is intercepted.
  for (const [mine, agreeing, differing] of [
    [genuine, ['proxy'], ['direct']],
    [gateway, ['direct'], ['proxy']],
  ]) {
    const split = verdict({ local: local(mine, 'unknown'), notaries });
    assert.equal(split.code, 'split');
    assert.equal(split.level, 'warn');
    assert.deepEqual(split.agreeing, agreeing);
    assert.deepEqual(split.differing, differing);
  }
});

test('same CA, other certificate → consistentSameCa', () => {
  const sibling = cert({ fp: 'cc', spki: 'k3', issuerCN: 'Public CA E2', aki: 'b2' });
  const v = verdict({ local: local(cert()), notaries: [notary('n', sibling)] });
  assert.equal(v.code, 'consistentSameCa');
  assert.equal(v.level, 'ok');
});

test('external sources only', () => {
  assert.equal(verdict({ local: null, notaries: [notary('a', cert()), notary('b', cert())] }).code, 'externalOnly');
  const v = verdict({ local: null, notaries: [notary('a', cert()), notary('b', cert({ fp: 'dd', spki: 'k9' }))] });
  assert.equal(v.code, 'externalDisagree');
  assert.equal(verdict({ local: null, notaries: [{ id: 'x', state: 'error' }] }).code, 'noSources');
});

test('plain HTTP pages are flagged whatever the certificate says', () => {
  const v = computeVerdict({
    target: { secure: false, host: 'example.com', port: 443 },
    local: null,
    notaries: [notary('a', cert())],
    now: NOW,
  });
  assert.equal(v.code, 'insecureHttp');
  assert.equal(v.level, 'warn');
});

test('warnings: expiry, host coverage, weak crypto, old TLS, untrusted at notary', () => {
  const codes = (v) => v.warnings.map((w) => w.code).sort();
  assert.deepEqual(codes(verdict({ local: local(cert({ days: -1 })) })), ['expired']);
  const soon = verdict({ local: local(cert({ days: 5 })) });
  assert.deepEqual(codes(soon), ['expiresSoon']);
  assert.equal(soon.warnings[0].days, 5);
  assert.deepEqual(codes(verdict({ local: null, notaries: [notary('a', cert({ dns: ['other.org'] }))] })), [
    'hostMismatch',
  ]);
  assert.deepEqual(codes(verdict({ local: local(cert({ sig: true, rsaBits: 1024 })) })), ['weakKey', 'weakSignature']);
  assert.deepEqual(codes(verdict({ local: local(cert(), 'compliant', 'TLS 1.0') })), ['obsoleteProtocol']);
  const untrusted = verdict({
    local: local(cert()),
    notaries: [notary('a', cert(), { trusted: false, trustError: 'CERT_HAS_EXPIRED' })],
  });
  assert.deepEqual(codes(untrusted), ['notaryUntrusted']);
  assert.deepEqual(codes(verdict({ local: local(cert(), 'unknown'), notaries: [notary('a', cert())] })), [
    'notPubliclyLogged',
  ]);
});

test('site memory: a switch to an unlogged certificate is an alarm, other switches are notes', () => {
  const memory = (kind, sameName = false) => ({
    status: 'changed',
    kind,
    sameName,
    learned: kind.endsWith('ToPublic'),
    current: { label: 'Now CA', public: kind.endsWith('ToPublic') },
    previous: { label: 'Before CA', public: kind.startsWith('public') },
  });
  const v = (kind, opts = {}) =>
    verdict({
      local: local(opts.leaf || cert(), opts.ct || 'unknown'),
      notaries: opts.notaries || [],
      memory: memory(kind, opts.sameName),
    });

  const alarm = v('publicToPrivate');
  assert.equal(alarm.code, 'caChangedToPrivate');
  assert.equal(alarm.level, 'danger');
  assert.equal(alarm.memoryChange.previous, 'Before CA');
  // Even notaries that "confirm" do not cancel it: their answer may be forged on the same path.
  assert.equal(v('publicToPrivate', { notaries: [notary('n', cert())] }).code, 'caChangedToPrivate');
  // A more specific interception verdict stays, with the history as a warning.
  const zscaler = cert({
    fp: 'ff',
    spki: 'z',
    issuerO: 'Zscaler Inc.',
    issuerCN: 'Zscaler Intermediate Root CA',
    aki: 'z',
  });
  const named = v('publicToPrivate', { leaf: zscaler, sameName: true });
  assert.equal(named.code, 'interceptorDetected');
  assert.equal(named.warnings[0].code, 'caChangedSameName');

  const private2 = v('privateToPrivate');
  assert.equal(private2.code, 'privateCa');
  assert.equal(private2.warnings[0].code, 'caChanged');
  assert.deepEqual([private2.warnings[0].previous, private2.warnings[0].current], ['Before CA', 'Now CA']);

  const public2 = v('publicToPublic', { ct: 'compliant' });
  assert.equal(public2.code, 'publicLocalOnly');
  assert.equal(public2.level, 'ok');
  assert.equal(public2.warnings[0].code, 'caChangedPublic');
  assert.equal(v('privateToPublic', { ct: 'compliant' }).warnings[0].code, 'caChangedNowPublic');

  for (const status of ['first', 'known', 'forgotten', 'disabled']) {
    const quiet = verdict({ local: local(cert(), 'compliant'), memory: { status } });
    assert.equal(quiet.code, 'publicLocalOnly', status);
    assert.equal(quiet.warnings.length, 0, status);
  }
});

test('parseTarget', () => {
  assert.deepEqual(parseTarget('https://Example.com/path?q=1'), {
    secure: true,
    host: 'example.com',
    port: 443,
    origin: 'https://example.com',
  });
  assert.deepEqual(parseTarget('https://example.com:8443/'), {
    secure: true,
    host: 'example.com',
    port: 8443,
    origin: 'https://example.com:8443',
  });
  assert.deepEqual(parseTarget('http://example.com:8080/'), {
    secure: false,
    host: 'example.com',
    port: 443,
    origin: 'http://example.com:8080',
  });
  assert.equal(parseTarget('https://[2001:db8::1]/').host, '2001:db8::1');
  assert.equal(parseTarget('chrome://settings'), null);
  assert.equal(parseTarget('file:///etc/hosts'), null);
  assert.equal(parseTarget('not a url'), null);
});

test('isInternalHost', () => {
  for (const h of [
    'localhost',
    'app.localhost',
    '10.1.2.3',
    '192.168.0.1',
    '172.20.0.5',
    '127.0.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    'intranet',
    'nas.local',
    'git.corp',
    'router.home.arpa',
  ]) {
    assert.equal(isInternalHost(h), true, h);
  }
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '2001:4860:4860::8888', 'bank.ro']) {
    assert.equal(isInternalHost(h), false, h);
  }
});

test('certificateCoversHost follows RFC 6125 wildcard rules', () => {
  const c = cert({ dns: ['example.com', '*.example.com'] });
  assert.equal(certificateCoversHost(c, 'example.com'), true);
  assert.equal(certificateCoversHost(c, 'www.example.com'), true);
  assert.equal(certificateCoversHost(c, 'a.b.example.com'), false);
  assert.equal(certificateCoversHost(c, 'example.org'), false);
  const ip = cert({ dns: [] });
  ip.extensions.subjectAltName.ip = ['192.0.2.1', '2001:db8::1'];
  assert.equal(certificateCoversHost(ip, '192.0.2.1'), true);
  assert.equal(certificateCoversHost(ip, '2001:db8::1'), true);
  assert.equal(certificateCoversHost(ip, '192.0.2.2'), false);
});

test('identifyInterceptor looks at issuers and the root', () => {
  assert.equal(
    identifyInterceptor([
      cert({ issuerO: 'Kaspersky Lab ZAO', issuerCN: 'Kaspersky Anti-Virus Personal Root Certificate' }),
    ]).name,
    'Kaspersky',
  );
  assert.equal(
    identifyInterceptor([cert({ issuerO: 'DigiCert Inc', issuerCN: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1' })]),
    null,
  );
  assert.equal(identifyInterceptor([]), null);
});
