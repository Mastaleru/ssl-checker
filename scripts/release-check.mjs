#!/usr/bin/env node
// Checks that the code can be released under a tag. The release workflow runs it
// before building, and you can run it before tagging:
//   npm run release:check -- v2.0.1
// - the tag is "v" plus the version in extension/manifest.json, and package.json
//   holds the same version;
// - the PlusPrivacy notary's public key is built into extension/lib/default-notary.js,
//   without which the extension never asks the notary.

import { readFileSync } from 'node:fs';
import { DEFAULT_NOTARY } from '../extension/lib/default-notary.js';
import { parsePublicKey } from '../extension/lib/notary-signature.js';

const versionIn = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).version;
const tag = process.argv[2] ?? '';
const manifest = versionIn('extension/manifest.json');
const packageVersion = versionIn('package.json');
const problems = [];

if (!/^v\d+(\.\d+){0,3}$/.test(tag)) {
  problems.push(`The tag must be "v" plus the version, e.g. v${manifest} (got "${tag}").`);
} else if (tag.slice(1) !== manifest) {
  problems.push(`The tag ${tag} does not match the version in extension/manifest.json (${manifest}).`);
}
if (packageVersion !== manifest) {
  problems.push(`package.json has version ${packageVersion} and extension/manifest.json ${manifest}; keep them equal.`);
}
if (DEFAULT_NOTARY.keys.length === 0) {
  problems.push(
    'extension/lib/default-notary.js holds no key for the PlusPrivacy notary: deploy the notary and add its key ' +
      'first (store/PUBLISHING.md, step 0).',
  );
}
for (const key of DEFAULT_NOTARY.keys) {
  if (!parsePublicKey(key)) {
    problems.push(`extension/lib/default-notary.js holds a malformed key: ${key}`);
  }
}

if (problems.length > 0) {
  console.error(`Not ready to release ${tag || '(no tag given)'}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Ready to release ${tag}: version ${manifest}, ${DEFAULT_NOTARY.keys.length} PlusPrivacy key(s).`);
