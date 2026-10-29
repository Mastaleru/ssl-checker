// User settings, kept in chrome.storage.local (tokens never leave this device).
import { DEFAULT_NOTARY } from './default-notary.js';

export const LOCAL_MODES = ['always', 'ask', 'never'];

// Version of the data-use disclosure that the user agrees to in the popup before the
// first check. Raise it when the extension starts handling data in a new way, so that
// everyone is asked again (Chrome Web Store disclosure and consent rules).
export const CONSENT_VERSION = 1;

export const DEFAULTS = Object.freeze({
  localMode: 'always',
  endpoints: [],
  timeoutMs: 8000,
  memoryEnabled: true,
  defaultNotary: true,
  consent: null, // { version, at } once the user agreed
});

/** True when this build ships the "debugger" permission (the full variant). */
export function localReadingAvailable() {
  const permissions = chrome.runtime.getManifest().permissions || [];
  return permissions.includes('debugger');
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
  if (!LOCAL_MODES.includes(settings.localMode)) {
    settings.localMode = DEFAULTS.localMode;
  }
  if (!Array.isArray(settings.endpoints)) {
    settings.endpoints = [];
  }
  settings.timeoutMs = clampTimeout(settings.timeoutMs);
  settings.memoryEnabled = settings.memoryEnabled !== false;
  settings.defaultNotary = settings.defaultNotary !== false;
  settings.consent = validConsent(settings.consent);
  if (!localReadingAvailable()) {
    settings.localMode = 'never';
  }
  return settings;
}

function validConsent(value) {
  return value && Number.isInteger(value.version) && typeof value.at === 'string' ? value : null;
}

/** True once the user agreed, in the popup, to the current data-use disclosure. */
export function hasConsent(settings) {
  return Boolean(settings.consent && settings.consent.version >= CONSENT_VERSION);
}

/** The sources a check asks: the PlusPrivacy notary when it is on, then the user's own. */
export function activeEndpoints(settings) {
  const own = settings.endpoints.filter((e) => e.enabled !== false);
  return settings.defaultNotary ? [DEFAULT_NOTARY, ...own] : own;
}

/** Records the user's agreement together with the choices made next to it. */
export async function giveConsent({ defaultNotary, memoryEnabled }) {
  await saveSettings({
    defaultNotary,
    memoryEnabled,
    consent: { version: CONSENT_VERSION, at: new Date().toISOString() },
  });
}

export async function saveSettings(patch) {
  const clean = {};
  if ('localMode' in patch && LOCAL_MODES.includes(patch.localMode)) {
    clean.localMode = patch.localMode;
  }
  if ('endpoints' in patch && Array.isArray(patch.endpoints)) {
    clean.endpoints = patch.endpoints;
  }
  if ('timeoutMs' in patch) {
    clean.timeoutMs = clampTimeout(patch.timeoutMs);
  }
  if ('memoryEnabled' in patch) {
    clean.memoryEnabled = Boolean(patch.memoryEnabled);
  }
  if ('defaultNotary' in patch) {
    clean.defaultNotary = Boolean(patch.defaultNotary);
  }
  if ('consent' in patch) {
    clean.consent = validConsent(patch.consent);
  }
  await chrome.storage.local.set(clean);
}

export function clampTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) {
    return DEFAULTS.timeoutMs;
  }
  return Math.min(30000, Math.max(2000, Math.round(n)));
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates a notary endpoint URL. HTTPS is required, except on loopback
 * (useful while testing a notary on your own machine).
 * Returns { ok: true, url } or { ok: false, error: <i18n key> }.
 */
export function validateEndpointUrl(input) {
  const raw = String(input || '').trim();
  let u;
  try {
    // Placeholders are not valid URL characters in the host; keep them in path/query only.
    u = new URL(raw.replace(/\{host\}/g, 'HOST_PLACEHOLDER').replace(/\{port\}/g, '443'));
  } catch {
    return { ok: false, error: 'endpointErrorInvalidUrl' };
  }
  if (u.username || u.password) {
    return { ok: false, error: 'endpointErrorCredentialsInUrl' };
  }
  if (u.hash) {
    return { ok: false, error: 'endpointErrorFragment' };
  }
  if (u.hostname.includes('host_placeholder')) {
    return { ok: false, error: 'endpointErrorPlaceholderInHost' };
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) {
    return { ok: false, error: 'endpointErrorHttps' };
  }
  return { ok: true, url: raw };
}

/** Builds the request URL for a notary: placeholders, or ?host=&port= appended. */
export function buildEndpointRequestUrl(template, host, port) {
  if (template.includes('{host}')) {
    return template.replace(/\{host\}/g, encodeURIComponent(host)).replace(/\{port\}/g, String(port));
  }
  const u = new URL(template);
  u.searchParams.set('host', host);
  u.searchParams.set('port', String(port));
  return u.toString();
}

export function newEndpointId() {
  return crypto.randomUUID();
}
