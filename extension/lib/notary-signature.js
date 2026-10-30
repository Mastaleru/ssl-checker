// Checks the signatures of notary answers (notary/README.md, "Signed answers").
//
// A notary with a signing key signs the exact bytes of each answer, preceded by a
// fixed context line, with Ed25519, and sends the signature in the Notary-Signature
// header. The answer carries the request's nonce and the notary's public key.
//
// For a notary whose keys the extension knows, an answer counts only when the
// signature holds for one of those keys, the nonce is the one just sent, and the
// host and port are the ones asked. So an interceptor on the way to the notary can
// neither change an answer, nor replay an old one, nor send the notary to look at a
// server of its choosing.

export const SIGNATURE_HEADER = 'Notary-Signature';

const CONTEXT = new TextEncoder().encode('SSL Checker notary answer v1\n');
const KEY_TEXT = /^ed25519:([A-Za-z0-9_-]{43})$/;
const SIGNATURE_TEXT = /^[A-Za-z0-9_-]{86}$/;

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The 32 bytes of an "ed25519:<base64url>" public key, or null when the text is not one. */
export function parsePublicKey(text) {
  const match = KEY_TEXT.exec(String(text ?? '').trim());
  if (!match) {
    return null;
  }
  const raw = fromBase64Url(match[1]);
  // 43 characters carry two bits more than 32 bytes: accept only the one spelling.
  return raw.length === 32 && toBase64Url(raw) === match[1] ? raw : null;
}

/**
 * Reads the keys typed in Options, separated by spaces or commas.
 * @returns {{ ok: true, keys: string[] } | { ok: false }}
 */
export function parseKeyList(input) {
  const keys = [];
  for (const item of String(input ?? '').split(/[\s,]+/)) {
    if (!item) {
      continue;
    }
    if (!parsePublicKey(item)) {
      return { ok: false };
    }
    if (!keys.includes(item)) {
      keys.push(item);
    }
  }
  return { ok: true, keys };
}

/** A fresh random value for one request: 16 bytes, base64url. */
export function newNonce() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Web Crypto itself failed: that says nothing about the answer, so it must not read as tampering. */
class CannotVerify extends Error {}

async function holds(keyText, signature, message) {
  const raw = parsePublicKey(keyText);
  if (!raw) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
  } catch (error) {
    throw new CannotVerify(String(error && error.message), { cause: error });
  }
}

// The host as the notary writes it (normalizeHost in notary/src/probe/target.js):
// lower case, without IPv6 brackets or a final dot, names in ASCII (punycode).
function normalizeHost(host) {
  const value = String(host ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (value === '' || value.includes(':')) {
    return value;
  }
  try {
    return new URL(`https://${value}/`).hostname;
  } catch {
    return value;
  }
}

const sameHost = (a, b) => normalizeHost(a) !== '' && normalizeHost(a) === normalizeHost(b);

/**
 * @param {object} input
 * @param {Uint8Array} input.body        the answer's bytes, exactly as received
 * @param {string|null} input.signature  the Notary-Signature header
 * @param {object} input.answer          the parsed body
 * @param {string[]} input.keys          the keys known for this notary; empty when none is
 * @param {string} input.nonce           the nonce sent with the request
 * @param {string} input.host            the host and port the request asked about
 * @param {number} input.port
 * @returns {Promise<{ status: 'verified' | 'selfSigned' | 'unsigned' | 'unknownKey' | 'tampered' | 'cannotVerify',
 *                     key?: string|null, reason?: 'signature' | 'nonce' | 'target' }>}
 *   verified: signed with a known key, for this request. selfSigned: no key is known,
 *   but the answer holds a signature by the key it names (which proves nothing about
 *   who sent it). tampered: an answer signed with a known key was changed, replayed or
 *   made for another request. cannotVerify: Web Crypto failed in this browser.
 */
export async function checkSignature(input) {
  try {
    return await check(input);
  } catch (error) {
    if (error instanceof CannotVerify) {
      return { status: 'cannotVerify' };
    }
    throw error;
  }
}

async function check({ body, signature, answer, keys, nonce, host, port }) {
  const text = typeof signature === 'string' ? signature.trim() : '';
  if (!SIGNATURE_TEXT.test(text)) {
    return { status: 'unsigned' };
  }
  const sig = fromBase64Url(text);
  const message = new Uint8Array(CONTEXT.length + body.length);
  message.set(CONTEXT);
  message.set(body, CONTEXT.length);
  const claimed = typeof answer.key === 'string' ? answer.key : null;

  if (keys.length === 0) {
    return claimed && (await holds(claimed, sig, message))
      ? { status: 'selfSigned', key: claimed }
      : { status: 'unsigned' };
  }
  let signer = null;
  for (const key of keys) {
    if (await holds(key, sig, message)) {
      signer = key;
      break;
    }
  }
  if (!signer) {
    // The answer names a known key but its signature does not hold: the bytes changed
    // on the way. A key nobody knows may just be a new one (or a forger's).
    return keys.includes(claimed)
      ? { status: 'tampered', reason: 'signature' }
      : { status: 'unknownKey', key: claimed };
  }
  if (answer.nonce !== nonce) {
    return { status: 'tampered', reason: 'nonce' };
  }
  if (!sameHost(answer.host, host) || answer.port !== port) {
    return { status: 'tampered', reason: 'target' };
  }
  return { status: 'verified', key: signer };
}
