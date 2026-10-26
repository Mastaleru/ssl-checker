// Storage for the site memory, in chrome.storage.local (it never leaves the device).
import { lastSeenOf, recordsToPrune } from './site-memory.js';

const PREFIX = 'site:';
const PRUNED_AT = 'memoryPrunedAt';
const DAY = 86400000;

export const siteKey = (host, port) => `${PREFIX}${host}#${port}`;

export async function loadSiteRecord(host, port) {
  const key = siteKey(host, port);
  return (await chrome.storage.local.get(key))[key] || null;
}

export async function saveSiteRecord(record) {
  await chrome.storage.local.set({ [siteKey(record.host, record.port)]: record });
  await pruneDaily();
}

export async function forgetSite(host, port) {
  await chrome.storage.local.remove(siteKey(host, port));
}

async function siteEntries() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([key]) => key.startsWith(PREFIX));
}

export async function countSites() {
  return (await siteEntries()).length;
}

export async function forgetAllSites() {
  const keys = (await siteEntries()).map(([key]) => key);
  if (keys.length) await chrome.storage.local.remove(keys);
}

/** Drops records unseen for a long time, at most once a day. */
async function pruneDaily(now = Date.now()) {
  const { [PRUNED_AT]: last = 0 } = await chrome.storage.local.get(PRUNED_AT);
  if (now - last < DAY) return;
  const entries = (await siteEntries()).map(([key, record]) => ({ key, lastSeen: lastSeenOf(record) }));
  const stale = recordsToPrune(entries, now);
  if (stale.length) await chrome.storage.local.remove(stale);
  await chrome.storage.local.set({ [PRUNED_AT]: now });
}
