// plural() picks the message of the UI language's plural category, and falls back
// to <base>Other for a category the language has no message for.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MESSAGES = {
  pl: {
    checksOne: '$1 sprawdzenie',
    checksFew: '$1 sprawdzenia',
    checksMany: '$1 sprawdzeń',
    checksOther: '$1 sprawdzenia',
  },
  es: { checksOne: '$1 comprobación', checksFew: '$1 comprobaciones', checksOther: '$1 comprobaciones' },
};

async function pluralIn(lang) {
  const table = MESSAGES[lang];
  globalThis.chrome = {
    i18n: {
      getMessage: (key, subs = []) =>
        key === 'localeCode' ? lang : (table[key] || '').replace(/\$(\d)/g, (_, n) => subs[n - 1]),
      getUILanguage: () => lang,
    },
  };
  // A fresh copy of the module, which reads the language when it loads.
  const { plural } = await import(`../extension/lib/i18n.js?${lang}`);
  return plural;
}

test('Polish has one, few and many', async () => {
  const plural = await pluralIn('pl');
  assert.equal(plural('checks', 1), '1 sprawdzenie');
  assert.equal(plural('checks', 3), '3 sprawdzenia');
  assert.equal(plural('checks', 5), '5 sprawdzeń');
  assert.equal(plural('checks', 22), '22 sprawdzenia');
  assert.equal(plural('checks', 25), '25 sprawdzeń');
});

test('a category without a message, such as Spanish "many", uses Other', async () => {
  const plural = await pluralIn('es');
  assert.equal(plural('checks', 1), '1 comprobación');
  assert.equal(plural('checks', 7), '7 comprobaciones');
  assert.equal(plural('checks', 1000000), '1000000 comprobaciones');
});
