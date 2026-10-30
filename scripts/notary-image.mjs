#!/usr/bin/env node
// Builds the notary's Docker image on this computer and saves it as a .tar.gz to
// upload to the VPS, where `docker load` and `docker compose up -d` run it without
// building anything there (notary/README.md, step 8):
//   node scripts/notary-image.mjs                          linux/amd64, what most VPS run
//   node scripts/notary-image.mjs --platform linux/arm64   for an ARM server
// Writes dist/ssl-checker-notary-<version>-linux-<arch>.tar.gz and a .sha256 next to it.
// Needs Docker (Docker Desktop on Windows and macOS). The signing key is never in the
// image: .dockerignore leaves notary/secrets out, and the key stays on the server.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTARY = join(ROOT, 'notary');
const DIST = join(ROOT, 'dist');
// compose.yaml runs ssl-checker-notary:local; the version tag says what it is.
const IMAGE = 'ssl-checker-notary';
const PLATFORMS = ['linux/amd64', 'linux/arm64'];

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function platformFrom(args) {
  const [option, value] = args.length === 1 ? args[0].split('=') : args;
  if (args.length === 0) {
    return PLATFORMS[0];
  }
  if (args.length <= 2 && option === '--platform' && PLATFORMS.includes(value)) {
    return value;
  }
  return fail(`Usage: node scripts/notary-image.mjs [--platform ${PLATFORMS.join('|')}]`);
}

function checkDocker() {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (probe.error) {
    fail('Docker was not found. Install Docker Desktop (or Docker Engine) and run this again.');
  }
  if (probe.status !== 0) {
    fail(`Docker is installed but not running: start Docker Desktop and run this again.\n${probe.stderr.trim()}`);
  }
}

/** The commit the image is built from, marked "-dirty" when notary/ has uncommitted changes. */
function revision() {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const head = git(['rev-parse', '--short', 'HEAD']);
  if (head.error || head.status !== 0) {
    return 'unknown';
  }
  return head.stdout.trim() + (git(['status', '--porcelain', '--', 'notary']).stdout.trim() ? '-dirty' : '');
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Streams `docker save` through gzip into `file`; a failed save leaves no file behind. */
async function saveImage(tags, file) {
  const partial = `${file}.partial`;
  const save = spawn('docker', ['save', ...tags], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((resolve, reject) => {
    save.once('error', reject);
    save.once('close', resolve);
  });
  try {
    await pipeline(save.stdout, zlib.createGzip(), createWriteStream(partial));
    const code = await exited;
    if (code !== 0) {
      throw new Error(`docker save exited with code ${code}`);
    }
    renameSync(partial, file);
  } catch (error) {
    rmSync(partial, { force: true });
    fail(`Saving the image failed: ${error.message}`);
  }
}

const platform = platformFrom(process.argv.slice(2));
const { version } = JSON.parse(readFileSync(join(NOTARY, 'package.json'), 'utf8'));
const rev = revision();
const tags = [`${IMAGE}:local`, `${IMAGE}:${version}`];
const file = join(DIST, `${IMAGE}-${version}-${platform.replace('/', '-')}.tar.gz`);
const name = basename(file);

checkDocker();
if (rev.endsWith('-dirty')) {
  console.warn('Note: notary/ has uncommitted changes; the image is labelled as such.');
}
console.log(`Building ${tags.join(' and ')} for ${platform} from ${rev}…`);
const build = spawnSync(
  'docker',
  [
    'build',
    '--pull',
    '--platform',
    platform,
    '--provenance=false',
    '--label',
    `org.opencontainers.image.version=${version}`,
    '--label',
    `org.opencontainers.image.revision=${rev}`,
    '--label',
    'org.opencontainers.image.source=https://github.com/Mastaleru/ssl-checker',
    ...tags.flatMap((tag) => ['--tag', tag]),
    NOTARY,
  ],
  { stdio: 'inherit' },
);
if (build.error || build.status !== 0) {
  fail('docker build failed; see its output above.');
}

mkdirSync(DIST, { recursive: true });
console.log(`Saving it to ${relative(ROOT, file)}…`);
await saveImage(tags, file);
writeFileSync(`${file}.sha256`, `${await sha256(file)}  ${name}\n`);

const megabytes = (statSync(file).size / 1024 / 1024).toFixed(1);
const local = (path) => relative(ROOT, path).split('\\').join('/');
console.log(`
Done: ${local(file)} (${megabytes} MB) and ${local(`${file}.sha256`)}.

Upload both, then load the image on the server and start it:
  scp ${local(file)} ${local(`${file}.sha256`)} <user>@<server>:
  sha256sum -c ${name}.sha256 && docker load -i ${name}
  cd ssl-checker/notary && docker compose up -d

Without --build, compose runs the image you loaded instead of building one.`);
