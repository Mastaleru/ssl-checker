// Signed answers: with SIGNING_KEY_FILE set, the notary signs every certificate
// answer with its Ed25519 key, so that nobody between the extension and the notary
// can change an answer unnoticed.
//
// The signature covers the exact bytes of the answer's body, preceded by a fixed
// context line, and travels base64url-encoded in the Notary-Signature header. The
// body itself carries the request's nonce and the notary's public key (README.md,
// "Signed answers").
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

export const SIGNATURE_HEADER = 'Notary-Signature';
export const SIGNATURE_CONTEXT = 'SSL Checker notary answer v1\n';

const CONTEXT = Buffer.from(SIGNATURE_CONTEXT);

/** The public half of a key, as the extension and the docs write it: "ed25519:<base64url>". */
export function publicKeyText(key) {
  return `ed25519:${createPublicKey(key).export({ format: 'jwk' }).x}`;
}

/**
 * @param {string | Buffer} pem  an Ed25519 private key in PEM, as `openssl genpkey -algorithm ed25519` writes it
 * @returns {{ publicKey: string, sign: (body: Buffer) => string }}
 */
export function createSigner(pem) {
  let key;
  try {
    key = createPrivateKey(pem);
  } catch (error) {
    throw new Error(`not a readable private key (${error.message})`, { cause: error });
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`an Ed25519 key is needed, not ${key.asymmetricKeyType}`);
  }
  return {
    publicKey: publicKeyText(key),
    sign: (body) => sign(null, Buffer.concat([CONTEXT, body]), key).toString('base64url'),
  };
}
