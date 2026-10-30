// ESLint looks for likely mistakes (its recommended rules) and requires braces
// around the body of every if, else, for, while and do, which Prettier never adds.
// None of these rules is about layout: formatting is Prettier's job.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'tests/e2e/output/'] },
  js.configs.recommended,
  {
    rules: {
      curly: ['error', 'all'],
      // `const { der, ...rest } = cert` is how the code drops a field from a copy.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  // The service worker and the modules in lib/ run without a DOM: lib/ is shared
  // by the service worker, the pages and the Node.js unit tests.
  {
    files: ['extension/background/**', 'extension/lib/**'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.webextensions } },
  },
  // The popup and options pages, and the DOM code in ui/.
  {
    files: ['extension/popup/**', 'extension/options/**', 'extension/ui/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  // Node.js: the notary, the build, the tests and the store tools.
  {
    files: ['notary/**', 'scripts/**', 'tests/**', 'store/tools/**', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  // The functions these scripts pass to Playwright's evaluate() run inside the
  // extension's pages and service worker.
  {
    files: ['tests/e2e/**', 'store/tools/**'],
    languageOptions: { globals: { chrome: 'readonly', document: 'readonly', window: 'readonly' } },
  },
];
