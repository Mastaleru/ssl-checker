import { readLocalCertificate } from './local-source.js';
import { queryNotary } from './notary-source.js';
import { describeChain } from '../lib/x509.js';
import { computeVerdict } from '../lib/verdict.js';
import { getSettings, localReadingAvailable } from '../lib/settings.js';
import { isInternalHost, parseTarget } from '../lib/hostnames.js';
import { assess, describe, learn, observationFrom } from '../lib/site-memory.js';
import { forgetSite, loadSiteRecord, saveSiteRecord } from '../lib/site-memory-store.js';

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

async function isIncognitoTab(tabId) {
  try {
    return Boolean((await chrome.tabs.get(tabId)).incognito);
  } catch {
    return false;
  }
}

/**
 * Compares a successful local reading with what is remembered for the site and
 * records it when appropriate. Returns the memory part of the result, or null
 * when nothing was read from the browser.
 *
 * Incognito tabs never touch the memory: chrome.storage.local is shared with
 * incognito windows, so recording there would outlive the private session.
 */
async function updateSiteMemory(target, local, settings, incognito) {
  if (local.state !== 'ok') return null;
  if (incognito) return { status: 'incognito' };
  if (!settings.memoryEnabled) return { status: 'disabled' };
  try {
    const observation = observationFrom(local, new Date().toISOString());
    const record = await loadSiteRecord(target.host, target.port);
    const assessment = assess(record, observation);
    let stored = record;
    if (assessment.autoLearn) {
      stored = learn(record, observation, target);
      await saveSiteRecord(stored);
    }
    return describe(assessment, stored, observation);
  } catch {
    return null; // storage trouble must not break the check itself
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

  const [localResult, notaries, incognito] = await Promise.all([localTask, notaryTask, isIncognitoTab(tabId)]);
  const memory = await updateSiteMemory(target, localResult, settings, incognito);
  const verdict = computeVerdict({
    target,
    local: localResult.state === 'ok' ? localResult : null,
    notaries,
    memory,
  });
  const result = {
    v: RESULT_VERSION,
    tabId,
    origin: target.origin,
    host: target.host,
    port: target.port,
    secure: target.secure,
    internal,
    incognito,
    checkedAt: new Date().toISOString(),
    localMode: settings.localMode,
    localAvailable,
    endpointsConfigured: endpoints.length,
    local: localResult,
    notaries,
    memory,
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

/** Replaces the memory part of a stored result and recomputes its verdict. */
async function updateStoredResult(result, target, memory) {
  const updated = {
    ...result,
    memory,
    verdict: computeVerdict({ target, local: result.local.state === 'ok' ? result.local : null, notaries: result.notaries, memory }),
  };
  try {
    await chrome.storage.session.set({ [resultKey(result.tabId)]: updated });
  } catch {
    /* the popup still gets the result directly */
  }
  await setBadge(result.tabId, updated.verdict.level);
  return updated;
}

async function resultForAction(tabId, url) {
  if (inFlight.has(tabId)) await inFlight.get(tabId).catch(() => {});
  const target = parseTarget(url);
  const result = target ? await cachedResult(tabId, target.origin) : null;
  if (!result) throw new Error('Check the site again first.');
  if (result.incognito || (await isIncognitoTab(tabId))) throw new Error('Site memory is off in incognito windows.');
  return { target, result };
}

/** "Trust it for this site": remembers the CA the browser saw in the last check. */
async function trustCurrentCa(tabId, url) {
  const { target, result } = await resultForAction(tabId, url);
  if (!result.local || result.local.state !== 'ok') throw new Error('Nothing was read from the browser for this site.');
  const observation = observationFrom(result.local, new Date().toISOString());
  const stored = learn(await loadSiteRecord(target.host, target.port), observation, target);
  await saveSiteRecord(stored);
  return updateStoredResult(result, target, { ...describe(assess(stored, observation), stored, observation), trusted: true });
}

async function forgetSiteOfTab(tabId, url) {
  const { target, result } = await resultForAction(tabId, url);
  await forgetSite(target.host, target.port);
  return updateStoredResult(result, target, { status: 'forgotten' });
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
  trustCa: (m) => trustCurrentCa(m.tabId, m.url),
  forgetSite: (m) => forgetSiteOfTab(m.tabId, m.url),
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
