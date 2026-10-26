// Prettier formats the code but never adds or removes braces, so ESLint enforces
// that one rule: the body of every if, else, for, while and do is a block.
export default [
  { ignores: ['dist/', 'tests/e2e/output/'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      curly: ['error', 'all'],
    },
  },
];
