// Compares the extension's X.509 decoder with reference values produced by
// pyca/cryptography (tests/tools/dump_expected.py). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeCertificate, parseCertificate, base64ToBytes } from '../extension/lib/x509.js';

const FIXTURES = new URL('./fixtures/certs/', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('./fixtures/expected.json', import.meta.url), 'utf8'));

const pemBlocks = (text) =>
  [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)].map((m) =>
    m[1].replace(/\s+/g, ''),
  );
const stripZeros = (hex) => hex.replace(/^0+(?=.)/, '');
const nameAsArrays = (name) => name.rdns.map((rdn) => rdn.map((a) => [a.oid, a.value]));

for (const [key, exp] of Object.entries(expected)) {
  test(`decodes ${key}`, async () => {
    const [file, index] = key.split('#');
    const b64 = pemBlocks(readFileSync(new URL(file, FIXTURES), 'utf8'))[Number(index)];
    const c = await describeCertificate(b64);

    assert.equal(c.version, exp.version, 'version');
    assert.equal(stripZeros(c.serialNumber), exp.serialNumber, 'serial');
    assert.equal(c.signatureAlgorithm.oid, exp.signatureOid, 'signature algorithm');
    assert.equal(c.notBefore, exp.notBefore, 'notBefore');
    assert.equal(c.notAfter, exp.notAfter, 'notAfter');
    assert.deepEqual(nameAsArrays(c.subject), exp.subject, 'subject');
    assert.deepEqual(nameAsArrays(c.issuer), exp.issuer, 'issuer');
    assert.equal(c.publicKey.algorithm, exp.publicKey.algorithm, 'key algorithm');
    assert.equal(c.publicKey.bits, exp.publicKey.bits, 'key bits');
    assert.equal(c.publicKey.curve, exp.publicKey.curve, 'curve');
    assert.equal(c.fingerprints.sha256, exp.sha256, 'sha256');
    assert.equal(c.fingerprints.sha1, exp.sha1, 'sha1');
    assert.equal(c.fingerprints.spkiSha256, exp.spkiSha256, 'spki pin');
    assert.deepEqual(
      c.extensions.list.map((e) => [e.oid, e.critical]),
      exp.extensions,
      'extension list',
    );
    assert.ok(
      c.extensions.list.every((e) => !e.error),
      'no extension failed to decode',
    );

    const e = c.extensions;
    if (exp.san) {
      assert.deepEqual(e.subjectAltName.dns, exp.san.dns, 'SAN dns');
      assert.deepEqual(e.subjectAltName.ip, exp.san.ip, 'SAN ip');
      assert.deepEqual(e.subjectAltName.email, exp.san.email, 'SAN email');
      assert.deepEqual(e.subjectAltName.uri, exp.san.uri, 'SAN uri');
      assert.equal(e.subjectAltName.directoryName.length, exp.san.dirCount, 'SAN dirName');
    } else {
      assert.equal(e.subjectAltName, null);
    }
    assert.deepEqual(e.basicConstraints, exp.basicConstraints, 'basicConstraints');
    assert.deepEqual(e.keyUsage, exp.keyUsage, 'keyUsage');
    assert.deepEqual(e.extKeyUsage && e.extKeyUsage.map((x) => x.oid), exp.eku, 'EKU');
    assert.deepEqual(e.policies && e.policies.map((x) => x.oid), exp.policies, 'policies');
    assert.deepEqual(e.ocsp, exp.ocsp, 'OCSP');
    assert.deepEqual(e.caIssuers, exp.caIssuers, 'caIssuers');
    assert.deepEqual(e.crl, exp.crl, 'CRL');
    assert.equal(e.subjectKeyId, exp.ski, 'SKI');
    assert.equal(e.authorityKeyId, exp.aki, 'AKI');
    assert.deepEqual(e.scts && e.scts.map(({ logId, timestamp }) => ({ logId, timestamp })), exp.scts, 'SCTs');
    assert.equal(e.mustStaple, exp.mustStaple, 'must-staple');
  });
}

test('formats names, validation level and PSS', async () => {
  const read = (f) => pemBlocks(readFileSync(new URL(f, FIXTURES), 'utf8'))[0];
  const ed = await describeCertificate(read('gen-ed25519-utf8.pem'));
  // DER sorts the members of a multi-valued RDN (SET OF), so UID precedes CN here.
  assert.equal(ed.subject.dn, 'UID=u-42+CN=ed.example.test, O=Ștefan & Fiii\\, S.R.L., L=Iași, C=RO');
  assert.equal(ed.subject.organization, 'Ștefan & Fiii, S.R.L.');
  const p384 = await describeCertificate(read('gen-p384-sans.pem'));
  assert.equal(p384.extensions.validationLevel, 'EV');
  // The fixture stores CN before C; RFC 4514 display order reverses the RDN sequence.
  assert.deepEqual(p384.extensions.subjectAltName.directoryName, ['C=RO, CN=Dir Name']);
  const pss = await describeCertificate(read('gen-pss-unknown-ext.pem'));
  assert.equal(pss.signatureAlgorithm.name, 'RSA-PSS with SHA-256');
  const v1 = await describeCertificate(read('openssl-v1-sha1.pem'));
  assert.equal(v1.signatureAlgorithm.weak, true);
  assert.equal(v1.selfIssued, true);
});

test('rejects malformed input instead of returning garbage', () => {
  const good = base64ToBytes(pemBlocks(readFileSync(new URL('gen-root-rsa2048.pem', FIXTURES), 'utf8'))[0]);
  assert.throws(() => parseCertificate(good.subarray(0, good.length - 10)));
  const trailing = new Uint8Array(good.length + 2);
  trailing.set(good);
  assert.throws(() => parseCertificate(trailing));
  assert.throws(() => parseCertificate(new Uint8Array([0x30, 0x84, 0xff, 0xff, 0xff, 0xff])));
  assert.throws(() => parseCertificate(new Uint8Array([])));
});
