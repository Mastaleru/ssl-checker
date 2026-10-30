import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareVersions, parseVersion, replaceLockVersion, replaceVersion } from '../scripts/version.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('versions follow Chrome: one to four numbers up to 65535, no leading zeros', () => {
  assert.deepEqual(parseVersion('2.0.2'), [2, 0, 2]);
  assert.deepEqual(parseVersion('v2.0.2'), [2, 0, 2]);
  assert.deepEqual(parseVersion('3'), [3]);
  assert.deepEqual(parseVersion('1.2.3.65535'), [1, 2, 3, 65535]);
  for (const bad of ['', '2.0.', '.2', '2..0', '2.0.02', '1.2.3.4.5', '65536', 'x2.0', '2.0.1-beta', ' ', null]) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
});

test('a version compares by its numbers, missing parts counting as 0', () => {
  assert.ok(compareVersions([2, 0, 2], [2, 0, 1]) > 0);
  assert.ok(compareVersions([2, 0, 10], [2, 0, 9]) > 0);
  assert.ok(compareVersions([2, 1], [2, 0, 9]) > 0);
  assert.equal(compareVersions([2, 0], [2, 0, 0]), 0);
  assert.ok(compareVersions([1, 9, 9], [2]) < 0);
});

test('only the top-level version changes, in every file the script writes', () => {
  for (const file of ['extension/manifest.json', 'package.json']) {
    const text = read(file);
    const changed = replaceVersion(text, '9.8.7');
    assert.deepEqual(JSON.parse(changed), { ...JSON.parse(text), version: '9.8.7' }, file);
    assert.equal(changed.split('\n').length, text.split('\n').length, file);
  }
  const lock = read('package-lock.json');
  const changed = JSON.parse(replaceLockVersion(lock, '9.8.7'));
  const original = JSON.parse(lock);
  assert.equal(changed.version, '9.8.7');
  assert.equal(changed.packages[''].version, '9.8.7');
  assert.deepEqual({ ...changed.packages, '': null }, { ...original.packages, '': null });
  // Written exactly as npm writes it: the same version gives back the same bytes.
  assert.equal(replaceLockVersion(lock, original.version), lock);
});
