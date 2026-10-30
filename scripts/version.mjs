// The extension's version as Chrome reads it, for scripts/bump-version.mjs.

/**
 * Chrome's rule for "version": one to four numbers from 0 to 65535, separated by dots,
 * without leading zeros. A leading "v", as in a tag, is accepted and dropped.
 * @returns {number[] | null}
 */
export function parseVersion(text) {
  const match = /^v?((?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3})$/.exec(String(text ?? '').trim());
  if (!match) {
    return null;
  }
  const parts = match[1].split('.').map(Number);
  return parts.every((n) => n <= 65535) ? parts : null;
}

/** Negative, zero or positive, like a sort comparator. Missing parts count as 0. */
export function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Sets the first "version" key of a JSON text (the top-level one), keeping the rest as it is. */
export function replaceVersion(text, version) {
  const pattern = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  if (!pattern.test(text)) {
    throw new Error('no "version" key');
  }
  return text.replace(pattern, (_, before, after) => `${before}${version}${after}`);
}

/** Sets the root package's version in a package-lock.json text, written as npm writes it. */
export function replaceLockVersion(text, version) {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = version;
  }
  return `${JSON.stringify(lock, null, 2)}\n`;
}
