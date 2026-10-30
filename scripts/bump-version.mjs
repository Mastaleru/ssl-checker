// Sets a new version of the extension everywhere it is kept:
//   extension/manifest.json  what Chrome and the Web Store read, and what names the zips
//   package.json and the root of package-lock.json
// The new version must be higher, since the Chrome Web Store refuses an equal or lower
// one. Nothing is committed or tagged: the script prints the git commands for that.
//
//   npm run bump-version 2.0.2
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion, replaceLockVersion, replaceVersion } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  manifest: path.join(ROOT, 'extension/manifest.json'),
  package: path.join(ROOT, 'package.json'),
  lock: path.join(ROOT, 'package-lock.json'),
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

const wanted = parseVersion(process.argv[2]);
if (!wanted || process.argv.length > 3) {
  fail(
    'Usage: npm run bump-version <version>, for example: npm run bump-version 2.0.2\n' +
      'A version is one to four numbers from 0 to 65535, separated by dots.',
  );
}
const version = wanted.join('.');

const texts = Object.fromEntries(Object.entries(FILES).map(([name, file]) => [name, readFileSync(file, 'utf8')]));
const current = JSON.parse(texts.manifest).version;
if (compareVersions(wanted, parseVersion(current) || [0]) <= 0) {
  fail(`${version} is not higher than the current version, ${current}: the Chrome Web Store refuses that.`);
}

writeFileSync(FILES.manifest, replaceVersion(texts.manifest, version));
writeFileSync(FILES.package, replaceVersion(texts.package, version));
writeFileSync(FILES.lock, replaceLockVersion(texts.lock, version));

console.log(`Version ${current} → ${version} in extension/manifest.json, package.json and package-lock.json.

Next:
  git commit -m "Bump version to ${version}" extension/manifest.json package.json package-lock.json
  git push
Then, once CI is green on that push:
  git tag -a v${version} -m "SSL Checker ${version}"
  git push origin v${version}`);
