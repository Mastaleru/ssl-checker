import { readLocalCertificate } from './local-source.js';
import { queryNotary } from './notary-source.js';
import { describeChain } from '../lib/x509.js';
import { computeVerdict } from '../lib/verdict.js';
import { getSettings, localReadingAvailable } from '../lib/settings.js';
import { isInternalHost, parseTarget } from '../lib/hostnames.js';

const RESULT_VERSION = 1;
const resultKey = (tabId) => `result:${tabId}`;
const inFlight = new Map();

const BADGES = {
  ok: { text: '✓', color: '#1d7a4c' },
  warn: { text: '?', color: '#a15c00' },
  danger: { text: '!', color: '#b42318' },
};

async function setBadge(tabId, level) {
  const badge = BADGES[level];
  try {
    await chrome.action.setBadgeText({ tabId, text: badge ? badge.text : '' });
    if (badge) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
      await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    }
  } catch {
    /* the tab may be gone */
  }
}

async function readLocal(tabId, origin, reload) {
  try {
    const raw = await readLocalCertificate(tabId, origin, { reload });
    return {
      state: 'ok',
      via: raw.via,
      chain: await describeChain(raw.chainBase64),
      security: raw.security,
      remoteAddress: raw.remoteAddress,
      httpProtocol: raw.httpProtocol,
    };
  } catch (e) {
    return { state: 'error', reason: (e && e.code) || 'protocolError', detail: (e && e.detail) || (e && e.message) || null };
  }
}

async function cachedResult(tabId, origin, maxAgeMs) {
  const key = resultKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored || stored.v !== RESULT_VERSION || stored.origin !== origin) return null;
  if (maxAgeMs !== undefined && Date.now() - Date.parse(stored.checkedAt) > maxAgeMs) return null;
  return stored;
}

/**
 * Runs a check for a tab.
 * @param {object} req
 * @param {number} req.tabId
 * @param {string} req.url        URL of the tab, as seen by the popup
 * @param {boolean} [req.local]   true: read locally now (button); false: never; undefined: per settings
 * @param {boolean} [req.reload]  read locally by reloading the page (strict-CSP pages)
 * @param {boolean} [req.reuseExternal] reuse fresh notary answers from the previous check
 */
async function runCheck({ tabId, url, local, reload = false, reuseExternal = false }) {
  const target = parseTarget(url);
  if (!target) return { v: RESULT_VERSION, tabId, unsupported: true };

  const settings = await getSettings();
  const localAvailable = localReadingAvailable();
  const wantLocal =
    target.secure && localAvailable && local !== false && (local === true || reload || settings.localMode === 'always');
  const endpoints = settings.endpoints.filter((e) => e.enabled !== false);
  const internal = isInternalHost(target.host);

  const previous = reuseExternal ? await cachedResult(tabId, target.origin, 120000) : null;
  const localTask = wantLocal
    ? readLocal(tabId, target.origin, reload)
    : Promise.resolve({ state: !target.secure ? 'notApplicable' : !localAvailable ? 'unavailable' : 'notRequested' });
  const notaryTask = internal
    ? Promise.resolve(endpoints.map((e) => ({ id: e.id, name: e.name, state: 'skipped', reason: 'internalHost' })))
    : previous && !previous.notaries.some((n) => n.state === 'error')
      ? Promise.resolve(previous.notaries)
      : Promise.all(endpoints.map((e) => queryNotary(e, target.host, target.port, settings.timeoutMs)));

  const [localResult, notaries] = await Promise.all([localTask, notaryTask]);
  const verdict = computeVerdict({
    target,
    local: localResult.state === 'ok' ? localResult : null,
    notaries,
  });
  const result = {
    v: RESULT_VERSION,
    tabId,
    origin: target.origin,
    host: target.host,
    port: target.port,
    secure: target.secure,
    internal,
    checkedAt: new Date().toISOString(),
    localMode: settings.localMode,
    localAvailable,
    endpointsConfigured: endpoints.length,
    local: localResult,
    notaries,
    verdict,
  };
  try {
    await chrome.storage.session.set({ [resultKey(tabId)]: result });
  } catch {
    /* quota: the popup still gets the result directly */
  }
  await setBadge(tabId, verdict.level);
  return result;
}

function checkTab(request) {
  // One check per tab at a time: a second popup or click joins the running one.
  const running = inFlight.get(request.tabId);
  if (running) return running;
  const task = runCheck(request).finally(() => inFlight.delete(request.tabId));
  inFlight.set(request.tabId, task);
  return task;
}

async function testEndpoint(endpoint) {
  const settings = await getSettings();
  return queryNotary(endpoint, 'example.com', 443, settings.timeoutMs);
}

const handlers = {
  check: (m) => checkTab({ tabId: m.tabId, url: m.url, local: m.local, reload: m.reload, reuseExternal: m.reuseExternal }),
  cached: (m) => {
    const target = parseTarget(m.url);
    return target ? cachedResult(m.tabId, target.origin) : Promise.resolve(null);
  },
  isRunning: (m) => Promise.resolve(inFlight.has(m.tabId)),
  testEndpoint: (m) => testEndpoint(m.endpoint),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || !Object.hasOwn(handlers, message.type)) return false;
  handlers[message.type](message).then(
    (value) => sendResponse({ ok: true, value }),
    (error) => sendResponse({ ok: false, error: String((error && error.message) || error) }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(resultKey(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A new page load makes the badge stale; the stored result stays and is
  // re-validated by origin when the popup opens.
  if (changeInfo.status === 'loading' && !inFlight.has(tabId)) setBadge(tabId, null);
});
