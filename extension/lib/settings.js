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

/**
 * How to ask a notary about host:port. Any address without {host} gets a POST with
 * {host, port} as JSON, so that the site's name never appears in a URL, where servers
 * and proxies log it. An address with {host} is a template for servers that expect
 * the site in the URL: it is filled in and fetched with GET.
 * @returns {{method: 'POST', url: string, target: {host: string, port: number}} | {method: 'GET', url: string}}
 */
export function buildNotaryRequest(url, host, port) {
  if (!url.includes('{host}')) {
    return { method: 'POST', url: new URL(url).toString(), target: { host, port: Number(port) } };
  }
  const filled = url.replace(/\{host\}/g, encodeURIComponent(host)).replace(/\{port\}/g, String(port));
  if (url.includes('{port}')) {
    return { method: 'GET', url: filled };
  }
  // Without {port} the notary would look at port 443, whatever the tab's port.
  const u = new URL(filled);
  if (!u.searchParams.has('port')) {
    u.searchParams.set('port', String(port));
  }
  return { method: 'GET', url: u.toString() };
}

/**
 * True when a signed answer from this endpoint can be checked against the site it
 * was asked about: a POST names the site in its body, a template only when it puts
 * the site in the query (?host={host}), where the request can be read back.
 */
export function targetCanBeChecked(url) {
  try {
    const request = buildNotaryRequest(url, 'example.com', 443);
    return request.method === 'POST' || new URL(request.url).searchParams.has('host');
  } catch {
    return false;
  }
}

export function newEndpointId() {
  return crypto.randomUUID();
}
