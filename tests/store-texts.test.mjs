// The store texts: a description and screenshot captions for every language of the
// extension, within the store's limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const locales = readdirSync(`${root}extension/_locales`).sort();
const names = (dir, extension) =>
  readdirSync(`${root}${dir}`)
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .sort();

test('every language of the extension has a store description and screenshot captions, and no other language does', () => {
  assert.deepEqual(names('store/listing', '.txt'), locales);
  assert.deepEqual(names('store/tools/captions', '.json'), locales);
});

test('store descriptions fit the 2,000-character limit, line breaks counted twice', () => {
  for (const locale of locales) {
    const text = readFileSync(`${root}store/listing/${locale}.txt`, 'utf8').trimEnd();
    const length = text.length + (text.match(/\n/g) || []).length;
    assert.ok(length <= 2000, `${locale}: ${length} characters`);
  }
});

test('screenshot captions have a title and a text for each of the four images', () => {
  for (const locale of locales) {
    const captions = JSON.parse(readFileSync(`${root}store/tools/captions/${locale}.json`, 'utf8'));
    for (const image of ['confirmed', 'intercepted', 'details', 'options']) {
      const [title, text, ...rest] = captions[image] || [];
      assert.ok(title?.trim() && text?.trim() && rest.length === 0, `${locale}: ${image}`);
    }
  }
  // The promo tile is not localized in the store: only English needs its line.
  assert.ok(JSON.parse(readFileSync(`${root}store/tools/captions/en.json`, 'utf8')).tagline);
});
