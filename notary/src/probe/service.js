// Serves certificate lookups for the route: a short cache, one probe per host:port
// at a time, and two caps that protect the notary and the sites it contacts:
// simultaneous probes (MAX_CONCURRENT) and probes per minute for all clients
// together (GLOBAL_RATE_LIMIT). Answers from the cache count against neither.
import { NotaryError } from '../errors.js';

export function createCertService({
  probe,
  cacheMs,
  maxConcurrent,
  globalPerMinute,
  maxCacheEntries = 2000,
  now = Date.now,
}) {
  const cache = new Map();
  const pending = new Map();
  let active = 0;
  let windowStart = 0;
  let probesInWindow = 0;

  function takeGlobalSlot() {
    if (!globalPerMinute) {
      return true;
    }
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      probesInWindow = 0;
    }
    if (probesInWindow >= globalPerMinute) {
      return false;
    }
    probesInWindow += 1;
    return true;
  }

  /** @returns {Promise<{ value: object, cached: boolean }>} */
  async function lookup(host, port) {
    const key = `${host}:${port}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) {
      return { value: hit.value, cached: true };
    }
    if (pending.has(key)) {
      return { value: await pending.get(key), cached: true };
    }
    if (active >= maxConcurrent) {
      throw new NotaryError(503, 'busy', 'too many checks in progress', { 'Retry-After': '5' });
    }
    if (!takeGlobalSlot()) {
      throw new NotaryError(503, 'busy', 'the notary is at capacity; try again in a minute', { 'Retry-After': '60' });
    }
    active += 1;
    const task = probe(host, port)
      .then((value) => {
        if (cacheMs > 0) {
          cache.delete(key);
          cache.set(key, { value, expires: now() + cacheMs });
          if (cache.size > maxCacheEntries) {
            cache.delete(cache.keys().next().value);
          }
        }
        return value;
      })
      .finally(() => {
        active -= 1;
        pending.delete(key);
      });
    pending.set(key, task);
    return { value: await task, cached: false };
  }

  return {
    lookup,
    get active() {
      return active;
    },
  };
}
