// Every message key used by the extension exists in every locale, and the
// locales stay in sync with each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../extension/', import.meta.url));
const locales = readdirSync(join(root, '_locales'));
const messages = Object.fromEntries(
  locales.map((l) => [l, JSON.parse(readFileSync(join(root, '_locales', l, 'messages.json'), 'utf8'))]),
);

function files(dir, ext) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

function usedKeys() {
  const keys = new Set();
  for (const file of files(root, '.js')) {
    const src = readFileSync(file, 'utf8');
    // t('key'), t(cond ? 'a' : 'b'), plural('base', n)
    for (const m of src.matchAll(/\bt\(([^;]*?)(?:,\s*\[|\))/g)) {
      // skip literals that are compared against (r.localMode === 'ask' ? ...)
      for (const q of m[1].matchAll(/(?<![=!]==\s*)'([A-Za-z][A-Za-z_]*)'/g)) {
        keys.add(q[1]);
      }
    }
    for (const m of src.matchAll(/\bplural\('([A-Za-z_]+)'/g)) {
      ['One', 'Few', 'Other'].forEach((s) => keys.add(m[1] + s));
    }
    // Keys kept in lookup tables, e.g. ['ok', 'relationSameCertificate', null]
    for (const m of src.matchAll(
      /(?<!plural\()'((?:relation|endpointError|verdict)[A-Z][A-Za-z]+|ct(?:Compliant|NotCompliant|Unknown))'/g,
    )) {
      keys.add(m[1]);
    }
  }
  for (const file of files(root, '.html')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/data-i18n="([^"]+)"/g)) {
      keys.add(m[1]);
    }
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      m[1].split(',').forEach((pair) => keys.add(pair.split(':')[1].trim()));
    }
  }
  const manifest = readFileSync(join(root, 'manifest.json'), 'utf8');
  for (const m of manifest.matchAll(/__MSG_([A-Za-z_]+)__/g)) {
    keys.add(m[1]);
  }
  // Keys built from a prefix at runtime.
  for (const level of ['DV', 'OV', 'EV', 'IV']) {
    keys.add(`level_${level}`);
  }
  for (const kind of ['corporateProxy', 'cloudProxy', 'antivirus', 'contentFilter', 'debugProxy', 'adware']) {
    keys.add(`kind_${kind}`);
  }
  const ui = readFileSync(join(root, 'ui', 'messages.js'), 'utf8');
  const [localBlock, notaryBlock] = [...ui.matchAll(/new Set\(\[([\s\S]*?)\]\)/g)].map((m) => m[1]);
  for (const q of localBlock.matchAll(/'([A-Za-z]+)'/g)) {
    keys.add(`localErr_${q[1]}`);
  }
  for (const q of notaryBlock.matchAll(/'([A-Za-z]+)'/g)) {
    keys.add(`notaryErr_${q[1]}`);
  }
  ['localErr_generic', 'notaryErr_timeout', 'notaryErr_http', 'notaryErr_other'].forEach((k) => keys.add(k));
  return keys;
}

test('all locales define the same keys', () => {
  const [first, ...rest] = locales;
  for (const l of rest) {
    assert.deepEqual(Object.keys(messages[l]).sort(), Object.keys(messages[first]).sort(), l);
  }
});

test('every key used by the code exists', () => {
  for (const key of usedKeys()) {
    for (const l of locales) {
      assert.ok(messages[l][key], `${l} is missing "${key}"`);
    }
  }
});

test('messages use only $1-$9 placeholders', () => {
  for (const l of locales) {
    for (const [key, { message }] of Object.entries(messages[l])) {
      assert.doesNotMatch(message, /\$(?![1-9])/, `${l}.${key}`);
    }
  }
});

test('the store description fits the 132-character limit', () => {
  for (const l of locales) {
    for (const key of ['extDescription', 'extDescriptionLite']) {
      assert.ok(messages[l][key].message.length <= 132, `${l}.${key}`);
    }
  }
});
