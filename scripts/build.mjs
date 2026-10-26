#!/usr/bin/env node
// Builds the two store packages from extension/:
//   dist/ssl-checker-<version>.zip       full: reads the certificate from the browser (debugger permission)
//   dist/ssl-checker-lite-<version>.zip  lite: external sources only, no debugger permission
// Usage: node scripts/build.mjs [full|lite]   (both when omitted)

import { cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');

export function manifestFor(variant) {
  const manifest = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'));
  if (variant === 'lite') {
    manifest.name = '__MSG_extNameLite__';
    manifest.description = '__MSG_extDescriptionLite__';
    manifest.permissions = manifest.permissions.filter((p) => p !== 'debugger');
  }
  return manifest;
}

/** Copies extension/ into `outDir` with the variant's manifest. */
export function stageVariant(variant, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  cpSync(SOURCE, outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifestFor(variant), null, 2)}\n`);
  return outDir;
}

// --- minimal ZIP writer (deflate, no dependencies) -------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? listFiles(p) : [p];
    });
}

export function zipDirectory(dir, zipPath) {
  const local = [];
  const central = [];
  let offset = 0;
  // Fixed timestamp (1 Jan 2026) keeps builds reproducible.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'));
    const data = readFileSync(file);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + body.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(zipPath, Buffer.concat([...local, ...central, end]));
  return zipPath;
}

function build(variant) {
  const { version } = manifestFor(variant);
  const name = variant === 'lite' ? `ssl-checker-lite-${version}` : `ssl-checker-${version}`;
  const staged = stageVariant(variant, join(DIST, name));
  const zip = zipDirectory(staged, join(DIST, `${name}.zip`));
  console.log(`${variant.padEnd(4)} → ${relative(ROOT, zip)} (${statSync(zip).size} bytes), unpacked in ${relative(ROOT, staged)}`);
}

/**
 * True when this file is the script Node was started with (not imported by a
 * test). Node resolves links for the module URL but not for process.argv[1], so
 * both are compared as real paths: otherwise a run through a symlink, a Windows
 * junction or another letter case would silently build nothing.
 */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const requested = process.argv[2];
  if (requested && !['full', 'lite'].includes(requested)) {
    console.error(`Unknown variant "${requested}". Usage: node scripts/build.mjs [full|lite]`);
    process.exit(2);
  }
  mkdirSync(DIST, { recursive: true });
  for (const variant of requested ? [requested] : ['full', 'lite']) build(variant);
}
