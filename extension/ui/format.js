// Small formatting helpers shared by the popup and the options page.
import { base64ToBytes, toPem } from '../lib/x509.js';

export const colonHex = (hex) => (hex.toUpperCase().match(/../g) || []).join(':');

export const shortFingerprint = (hex) => `${hex.slice(0, 4)} ${hex.slice(4, 8)}`.toUpperCase();

export function hostLabel(host, port) {
  const name = host.includes(':') ? `[${host}]` : host;
  return port && port !== 443 ? `${name}:${port}` : name;
}

export function keyLabel(publicKey) {
  if (!publicKey) return '';
  switch (publicKey.algorithm) {
    case 'EC':
      return `ECDSA ${publicKey.curve || ''}`.trim();
    case 'RSA':
    case 'RSA-PSS':
      return publicKey.bits ? `${publicKey.algorithm} ${publicKey.bits}` : publicKey.algorithm;
    default:
      return publicKey.algorithm;
  }
}

export function primaryNames(cert) {
  const san = cert.extensions.subjectAltName;
  const names = san ? [...san.dns, ...san.ip] : [];
  if (names.length === 0 && cert.subject.commonName) names.push(cert.subject.commonName);
  return names;
}

export function subjectLabel(cert) {
  return cert.subject.commonName || cert.subject.organization || cert.subject.dn || '—';
}

export function chainToPem(chain) {
  return chain.map((cert) => toPem(base64ToBytes(cert.base64))).join('');
}

const TLS_SIGNATURE_SCHEMES = {
  0x0201: 'rsa_pkcs1_sha1',
  0x0203: 'ecdsa_sha1',
  0x0401: 'rsa_pkcs1_sha256',
  0x0403: 'ecdsa_secp256r1_sha256',
  0x0501: 'rsa_pkcs1_sha384',
  0x0503: 'ecdsa_secp384r1_sha384',
  0x0601: 'rsa_pkcs1_sha512',
  0x0603: 'ecdsa_secp521r1_sha512',
  0x0804: 'rsa_pss_rsae_sha256',
  0x0805: 'rsa_pss_rsae_sha384',
  0x0806: 'rsa_pss_rsae_sha512',
  0x0807: 'ed25519',
  0x0808: 'ed448',
  0x0809: 'rsa_pss_pss_sha256',
  0x0904: 'mldsa44',
  0x0905: 'mldsa65',
  0x0906: 'mldsa87',
};

export function tlsSignatureScheme(value) {
  if (typeof value !== 'number') return null;
  return TLS_SIGNATURE_SCHEMES[value] || `0x${value.toString(16).padStart(4, '0')}`;
}

/** Remaining validity, as { days, fraction elapsed, state }. */
export function validity(cert, now = Date.now()) {
  const start = Date.parse(cert.notBefore);
  const end = Date.parse(cert.notAfter);
  const days = Math.floor((end - now) / 86400000);
  const fraction = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
  const state = now > end ? 'expired' : now < start ? 'future' : days < 14 ? 'soon' : 'valid';
  return { days, fraction, state };
}
