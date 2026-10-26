// Minimal, dependency-free DER / X.509 decoder.
// It decodes what a certificate viewer needs; it does NOT verify signatures.

import {
  ACCESS_METHODS,
  EC_CURVES,
  EXTENDED_KEY_USAGES,
  EXTENSION_NAMES,
  EXTENSIONS,
  KEY_USAGE_BITS,
  NAME_ATTRIBUTES,
  POLICY_NAMES,
  PUBLIC_KEY_ALGORITHMS,
  SIGNATURE_ALGORITHMS,
  VALIDATION_POLICIES,
  WEAK_SIGNATURES,
} from './oids.js';

export class CertificateParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CertificateParseError';
  }
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes, separator = '') {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i && separator) out += separator;
    out += HEX[bytes[i]];
  }
  return out;
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function toPem(der) {
  const b64 = bytesToBase64(der);
  return `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

const utf8Decoder = new TextDecoder('utf-8');
const utf16beDecoder = new TextDecoder('utf-16be');

// ---------------------------------------------------------------------------
// DER reader
// ---------------------------------------------------------------------------

const CLASS_UNIVERSAL = 0;
const CLASS_CONTEXT = 2;

const T = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x10,
  SET: 0x11,
  NUMERIC_STRING: 0x12,
  PRINTABLE_STRING: 0x13,
  T61_STRING: 0x14,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  VISIBLE_STRING: 0x1a,
  UNIVERSAL_STRING: 0x1c,
  BMP_STRING: 0x1e,
};

/**
 * Reads one TLV at `pos`. Returns { cls, constructed, tag, headerStart, start, end }.
 * `start`/`end` delimit the value; `headerStart` is where the tag byte is.
 */
function readTlv(buf, pos, limit) {
  if (pos >= limit) throw new CertificateParseError('Unexpected end of data');
  const first = buf[pos];
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  let p = pos + 1;
  if (tag === 0x1f) {
    tag = 0;
    let b;
    do {
      if (p >= limit) throw new CertificateParseError('Truncated tag');
      b = buf[p++];
      tag = tag * 128 + (b & 0x7f);
    } while (b & 0x80);
  }
  if (p >= limit) throw new CertificateParseError('Truncated length');
  let length = buf[p++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new CertificateParseError('Unsupported length encoding');
    length = 0;
    for (let i = 0; i < count; i++) {
      if (p >= limit) throw new CertificateParseError('Truncated length');
      length = length * 256 + buf[p++];
    }
  }
  const end = p + length;
  if (end > limit) throw new CertificateParseError('Length exceeds available data');
  return { cls, constructed, tag, headerStart: pos, start: p, end };
}

function childrenOf(buf, node) {
  const out = [];
  let p = node.start;
  while (p < node.end) {
    const child = readTlv(buf, p, node.end);
    out.push(child);
    p = child.end;
  }
  return out;
}

const valueOf = (buf, node) => buf.subarray(node.start, node.end);
const encodedOf = (buf, node) => buf.subarray(node.headerStart, node.end);
const isUniversal = (node, tag) => node.cls === CLASS_UNIVERSAL && node.tag === tag;
const isContext = (node, tag) => node.cls === CLASS_CONTEXT && node.tag === tag;

function expectUniversal(node, tag, what) {
  if (!node || !isUniversal(node, tag)) throw new CertificateParseError(`Expected ${what}`);
  return node;
}

// ---------------------------------------------------------------------------
// Primitive decoders
// ---------------------------------------------------------------------------

export function decodeOid(bytes) {
  const arcs = [];
  let value = 0n;
  let first = true;
  for (const b of bytes) {
    value = (value << 7n) | BigInt(b & 0x7f);
    if (b & 0x80) continue;
    if (first) {
      if (value < 40n) arcs.push('0', value.toString());
      else if (value < 80n) arcs.push('1', (value - 40n).toString());
      else arcs.push('2', (value - 80n).toString());
      first = false;
    } else {
      arcs.push(value.toString());
    }
    value = 0n;
  }
  return arcs.join('.');
}

function decodeString(buf, node) {
  const bytes = valueOf(buf, node);
  if (node.cls !== CLASS_UNIVERSAL) return toHex(bytes);
  switch (node.tag) {
    case T.UTF8_STRING:
      return utf8Decoder.decode(bytes);
    case T.BMP_STRING:
      return utf16beDecoder.decode(bytes);
    case T.UNIVERSAL_STRING: {
      let s = '';
      for (let i = 0; i + 3 < bytes.length; i += 4) {
        s += String.fromCodePoint(((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0);
      }
      return s;
    }
    case T.PRINTABLE_STRING:
    case T.IA5_STRING:
    case T.NUMERIC_STRING:
    case T.VISIBLE_STRING:
    case T.T61_STRING:
      return latin1(bytes);
    default:
      return '#' + toHex(encodedOf(buf, node));
  }
}

function decodeTime(buf, node) {
  const s = latin1(valueOf(buf, node));
  let m;
  let year;
  if (isUniversal(node, T.UTC_TIME)) {
    m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?()(Z|[+-]\d{4})$/.exec(s);
    if (m) year = Number(m[1]) + (Number(m[1]) >= 50 ? 1900 : 2000);
  } else if (isUniversal(node, T.GENERALIZED_TIME)) {
    m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:[.,](\d+))?(Z|[+-]\d{4})?$/.exec(s);
    if (m) year = Number(m[1]);
  }
  if (!m) throw new CertificateParseError(`Invalid time "${s}"`);
  const ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0;
  let t = Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0), ms);
  const zone = m[8];
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    t -= sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5))) * 60000;
  }
  return new Date(t).toISOString();
}

/** INTEGER → lowercase hex without the DER sign byte. */
function integerHex(buf, node) {
  let bytes = valueOf(buf, node);
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  return toHex(bytes);
}

function integerNumber(buf, node) {
  const bytes = valueOf(buf, node);
  if (bytes.length > 6) return Number.MAX_SAFE_INTEGER;
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}

function bitLength(bytes) {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return 0;
  return (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i]));
}

export function formatIp(bytes) {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  if (bytes.length === 16) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 0; i < 8; ) {
      if (groups[i] !== 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < 8 && groups[j] === 0) j++;
      if (j - i > bestLen) {
        bestLen = j - i;
        bestStart = i;
      }
      i = j;
    }
    const hex = groups.map((g) => g.toString(16));
    if (bestLen < 2) return hex.join(':');
    return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
  }
  return toHex(bytes, ':');
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

function escapeDnValue(value) {
  let v = String(value).replace(/[\\,+"<>;=]/g, (c) => '\\' + c);
  if (/^[ #]/.test(v)) v = '\\' + v;
  if (/ $/.test(v)) v = v.slice(0, -1) + '\\ ';
  return v;
}

function parseName(buf, node) {
  expectUniversal(node, T.SEQUENCE, 'Name');
  const rdns = [];
  for (const rdn of childrenOf(buf, node)) {
    const group = [];
    for (const atv of childrenOf(buf, rdn)) {
      const [typeNode, valueNode] = childrenOf(buf, atv);
      const oid = decodeOid(valueOf(buf, expectUniversal(typeNode, T.OID, 'attribute type')));
      group.push({ oid, name: NAME_ATTRIBUTES[oid] || oid, value: decodeString(buf, valueNode) });
    }
    rdns.push(group);
  }
  const dn = rdns
    .slice()
    .reverse()
    .map((group) => group.map((a) => `${a.name}=${escapeDnValue(a.value)}`).join('+'))
    .join(', ');
  const attributes = rdns.flat();
  const first = (name) => {
    const hit = attributes.find((a) => a.name === name);
    return hit ? hit.value : null;
  };
  return {
    dn,
    rdns,
    raw: toHex(encodedOf(buf, node)),
    commonName: first('CN'),
    organization: first('O'),
    organizationalUnit: first('OU'),
    locality: first('L'),
    state: first('ST'),
    country: first('C'),
  };
}

function parseAlgorithmIdentifier(buf, node) {
  const [oidNode, paramsNode] = childrenOf(buf, expectUniversal(node, T.SEQUENCE, 'AlgorithmIdentifier'));
  return { oid: decodeOid(valueOf(buf, expectUniversal(oidNode, T.OID, 'algorithm'))), params: paramsNode || null };
}

const HASH_NAMES = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

function describeSignatureAlgorithm(buf, alg) {
  let name = SIGNATURE_ALGORITHMS[alg.oid] || alg.oid;
  if (alg.oid === '1.2.840.113549.1.1.10' && alg.params && isUniversal(alg.params, T.SEQUENCE)) {
    let hash = 'SHA-1';
    for (const child of childrenOf(buf, alg.params)) {
      if (isContext(child, 0)) {
        const inner = parseAlgorithmIdentifier(buf, childrenOf(buf, child)[0]);
        hash = HASH_NAMES[inner.oid] || inner.oid;
      }
    }
    name = `RSA-PSS with ${hash}`;
  }
  return { oid: alg.oid, name, weak: WEAK_SIGNATURES.has(alg.oid) };
}

function parsePublicKey(buf, node) {
  const [algNode, keyNode] = childrenOf(buf, expectUniversal(node, T.SEQUENCE, 'SubjectPublicKeyInfo'));
  const alg = parseAlgorithmIdentifier(buf, algNode);
  const info = { oid: alg.oid, algorithm: PUBLIC_KEY_ALGORITHMS[alg.oid] || alg.oid, bits: null, curve: null, exponent: null };
  const keyBits = valueOf(buf, expectUniversal(keyNode, T.BIT_STRING, 'subjectPublicKey')).subarray(1);
  if (info.algorithm === 'RSA' || info.algorithm === 'RSA-PSS') {
    try {
      const seq = readTlv(keyBits, 0, keyBits.length);
      const [modulus, exponent] = childrenOf(keyBits, seq);
      info.bits = bitLength(valueOf(keyBits, modulus));
      info.exponent = integerNumber(keyBits, exponent);
    } catch {
      /* leave bits unknown */
    }
  } else if (info.algorithm === 'EC') {
    if (alg.params && isUniversal(alg.params, T.OID)) {
      const curveOid = decodeOid(valueOf(buf, alg.params));
      const curve = EC_CURVES[curveOid];
      info.curve = curve ? curve.name : curveOid;
      info.bits = curve ? curve.bits : null;
    }
  } else if (info.algorithm === 'Ed25519' || info.algorithm === 'X25519') {
    info.bits = 256;
  } else if (info.algorithm === 'Ed448') {
    info.bits = 456;
  } else if (info.algorithm === 'X448') {
    info.bits = 448;
  }
  return { info, spki: encodedOf(buf, node) };
}

function parseGeneralNames(buf, node, into) {
  for (const gn of childrenOf(buf, node)) {
    if (gn.cls !== CLASS_CONTEXT) continue;
    const bytes = valueOf(buf, gn);
    switch (gn.tag) {
      case 1:
        into.email.push(latin1(bytes));
        break;
      case 2:
        into.dns.push(latin1(bytes));
        break;
      case 6:
        into.uri.push(latin1(bytes));
        break;
      case 7:
        into.ip.push(formatIp(bytes));
        break;
      case 4:
        into.directoryName.push(parseName(buf, childrenOf(buf, gn)[0]).dn);
        break;
      default:
        into.other += 1;
    }
  }
  return into;
}

const emptyGeneralNames = () => ({ dns: [], ip: [], email: [], uri: [], directoryName: [], other: 0 });

function parseSctList(octets) {
  const outer = readTlv(octets, 0, octets.length);
  const data = valueOf(octets, expectUniversal(outer, T.OCTET_STRING, 'SCT list'));
  if (data.length < 2) return [];
  const end = Math.min(2 + ((data[0] << 8) | data[1]), data.length);
  const out = [];
  let p = 2;
  while (p + 2 <= end) {
    const len = (data[p] << 8) | data[p + 1];
    p += 2;
    const sct = data.subarray(p, p + len);
    p += len;
    if (sct.length < 41) continue;
    let ts = 0;
    for (let k = 33; k < 41; k++) ts = ts * 256 + sct[k];
    out.push({ version: sct[0] + 1, logId: bytesToBase64(sct.subarray(1, 33)), timestamp: new Date(ts).toISOString() });
  }
  return out;
}

function parseExtensions(buf, node) {
  const ext = {
    subjectAltName: null,
    basicConstraints: null,
    keyUsage: null,
    extKeyUsage: null,
    policies: null,
    validationLevel: null,
    ocsp: [],
    caIssuers: [],
    crl: [],
    subjectKeyId: null,
    authorityKeyId: null,
    scts: null,
    mustStaple: false,
    precertificate: false,
    nameConstraints: false,
    list: [],
  };
  if (!node) return ext;
  for (const extNode of childrenOf(buf, expectUniversal(node, T.SEQUENCE, 'Extensions'))) {
    const parts = childrenOf(buf, extNode);
    const oid = decodeOid(valueOf(buf, expectUniversal(parts[0], T.OID, 'extnID')));
    let critical = false;
    let valueNode = parts[1];
    if (isUniversal(parts[1], T.BOOLEAN)) {
      critical = buf[parts[1].start] !== 0;
      valueNode = parts[2];
    }
    const entry = { oid, name: EXTENSION_NAMES[oid] || null, critical, error: false };
    ext.list.push(entry);
    const octets = valueOf(buf, expectUniversal(valueNode, T.OCTET_STRING, 'extnValue'));
    try {
      decodeExtension(oid, octets, ext);
    } catch {
      entry.error = true;
    }
  }
  return ext;
}

function decodeExtension(oid, octets, ext) {
  const root = () => readTlv(octets, 0, octets.length);
  switch (oid) {
    case EXTENSIONS.SUBJECT_ALT_NAME:
      ext.subjectAltName = parseGeneralNames(octets, root(), emptyGeneralNames());
      break;
    case EXTENSIONS.BASIC_CONSTRAINTS: {
      const bc = { ca: false, pathLen: null };
      for (const child of childrenOf(octets, root())) {
        if (isUniversal(child, T.BOOLEAN)) bc.ca = octets[child.start] !== 0;
        if (isUniversal(child, T.INTEGER)) bc.pathLen = integerNumber(octets, child);
      }
      ext.basicConstraints = bc;
      break;
    }
    case EXTENSIONS.KEY_USAGE: {
      const bits = valueOf(octets, root());
      const unused = bits[0] || 0;
      const total = (bits.length - 1) * 8 - unused;
      const usages = [];
      for (let i = 0; i < total; i++) {
        if (bits[1 + (i >> 3)] & (0x80 >> (i & 7))) usages.push(KEY_USAGE_BITS[i] || `bit${i}`);
      }
      ext.keyUsage = usages;
      break;
    }
    case EXTENSIONS.EXT_KEY_USAGE:
      ext.extKeyUsage = childrenOf(octets, root()).map((n) => {
        const id = decodeOid(valueOf(octets, n));
        return { oid: id, name: EXTENDED_KEY_USAGES[id] || id };
      });
      break;
    case EXTENSIONS.CERTIFICATE_POLICIES:
      ext.policies = childrenOf(octets, root()).map((info) => {
        const id = decodeOid(valueOf(octets, childrenOf(octets, info)[0]));
        return { oid: id, name: POLICY_NAMES[id] || id };
      });
      for (const p of ext.policies) {
        if (VALIDATION_POLICIES[p.oid]) {
          ext.validationLevel = VALIDATION_POLICIES[p.oid];
          break;
        }
      }
      break;
    case EXTENSIONS.AUTHORITY_INFO_ACCESS:
      for (const desc of childrenOf(octets, root())) {
        const [methodNode, locationNode] = childrenOf(octets, desc);
        const method = decodeOid(valueOf(octets, methodNode));
        if (!isContext(locationNode, 6)) continue;
        const uri = latin1(valueOf(octets, locationNode));
        if (method === ACCESS_METHODS.OCSP) ext.ocsp.push(uri);
        else if (method === ACCESS_METHODS.CA_ISSUERS) ext.caIssuers.push(uri);
      }
      break;
    case EXTENSIONS.CRL_DISTRIBUTION_POINTS:
      for (const dp of childrenOf(octets, root())) {
        for (const field of childrenOf(octets, dp)) {
          if (!isContext(field, 0)) continue;
          for (const name of childrenOf(octets, field)) {
            if (!isContext(name, 0)) continue;
            const names = parseGeneralNames(octets, name, emptyGeneralNames());
            ext.crl.push(...names.uri);
          }
        }
      }
      break;
    case EXTENSIONS.SUBJECT_KEY_ID:
      ext.subjectKeyId = toHex(valueOf(octets, root()));
      break;
    case EXTENSIONS.AUTHORITY_KEY_ID:
      for (const child of childrenOf(octets, root())) {
        if (isContext(child, 0)) ext.authorityKeyId = toHex(valueOf(octets, child));
      }
      break;
    case EXTENSIONS.SCT_LIST:
      ext.scts = parseSctList(octets);
      break;
    case EXTENSIONS.TLS_FEATURE:
      ext.mustStaple = childrenOf(octets, root()).some((n) => integerNumber(octets, n) === 5);
      break;
    case EXTENSIONS.CT_POISON:
      ext.precertificate = true;
      break;
    case EXTENSIONS.NAME_CONSTRAINTS:
      ext.nameConstraints = true;
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decodes a DER certificate. Returns plain data plus `der` and `spki` byte arrays.
 */
export function parseCertificate(input) {
  const der = input instanceof Uint8Array ? input : new Uint8Array(input);
  const certNode = expectUniversal(readTlv(der, 0, der.length), T.SEQUENCE, 'Certificate');
  if (certNode.end !== der.length) throw new CertificateParseError('Trailing data after certificate');
  const [tbsNode, sigAlgNode] = childrenOf(der, certNode);
  const tbs = childrenOf(der, expectUniversal(tbsNode, T.SEQUENCE, 'TBSCertificate'));

  let i = 0;
  let version = 1;
  if (isContext(tbs[0], 0)) {
    version = integerNumber(der, childrenOf(der, tbs[0])[0]) + 1;
    i++;
  }
  const serialNode = expectUniversal(tbs[i++], T.INTEGER, 'serialNumber');
  i++; // inner signature algorithm (repeated outside the TBS)
  const issuer = parseName(der, tbs[i++]);
  const validity = childrenOf(der, expectUniversal(tbs[i++], T.SEQUENCE, 'Validity'));
  const subject = parseName(der, tbs[i++]);
  const { info: publicKey, spki } = parsePublicKey(der, tbs[i++]);
  let extensionsNode = null;
  for (; i < tbs.length; i++) {
    if (isContext(tbs[i], 3)) extensionsNode = childrenOf(der, tbs[i])[0];
  }

  return {
    der,
    spki,
    version,
    serialNumber: integerHex(der, serialNode),
    signatureAlgorithm: describeSignatureAlgorithm(der, parseAlgorithmIdentifier(der, sigAlgNode)),
    issuer,
    subject,
    notBefore: decodeTime(der, validity[0]),
    notAfter: decodeTime(der, validity[1]),
    publicKey,
    extensions: parseExtensions(der, extensionsNode),
    selfIssued: issuer.raw === subject.raw,
  };
}

async function digest(algorithm, bytes) {
  return new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
}

/**
 * Parses a certificate and returns a JSON-serializable description, including
 * SHA-256 / SHA-1 fingerprints and the SPKI SHA-256 pin.
 */
export async function describeCertificate(input) {
  const der = typeof input === 'string' ? base64ToBytes(input) : input;
  const cert = parseCertificate(der);
  const [sha256, sha1, spkiSha256] = await Promise.all([
    digest('SHA-256', cert.der),
    digest('SHA-1', cert.der),
    digest('SHA-256', cert.spki),
  ]);
  const { der: _der, spki: _spki, ...rest } = cert;
  return {
    ...rest,
    base64: bytesToBase64(cert.der),
    fingerprints: { sha256: toHex(sha256), sha1: toHex(sha1), spkiSha256: bytesToBase64(spkiSha256) },
  };
}

/** Describes a whole chain (array of base64 DER strings), leaf first. */
export async function describeChain(base64List) {
  return Promise.all(base64List.map((b64) => describeCertificate(b64)));
}
