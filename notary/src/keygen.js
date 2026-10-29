// Creates the notary's signing key and prints its public key:
//   node src/keygen.js secrets/signing-key.pem
// An existing file is never overwritten: its public key is printed instead, so the
// same command also shows the key of a running notary:
//   docker compose exec notary node src/keygen.js /run/secrets/signing_key
// Only the public key goes to stdout; the messages go to stderr.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSigner } from './signing.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node src/keygen.js <key file>');
  process.exit(2);
}

let pem;
try {
  pem = readFileSync(file);
  console.error(`Key in ${file}:`);
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
  pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, pem, { mode: 0o600, flag: 'wx' });
  console.error(`Created a new key in ${file}. Keep a copy of it somewhere safe. Its public key:`);
}

try {
  console.log(createSigner(pem).publicKey);
} catch (error) {
  console.error(`${file} is not a signing key: ${error.message}`);
  process.exit(1);
}
