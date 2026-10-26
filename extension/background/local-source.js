// Reads the certificate the browser actually received for a tab, through the
// Chrome DevTools Protocol (chrome.debugger). Chrome has no other extension API
// for this.
//
// Network.getCertificate only knows certificates of responses observed while the
// Network domain is enabled, so we trigger one tiny same-origin request (HEAD
// /favicon.ico, no cookies) from an isolated world the page cannot tamper with.
// Pages with a strict CSP block that request; for them the caller can ask for a
// reload instead.

const PROTOCOL_VERSION = '1.3';
const PROBE_TIMEOUT_MS = 4000;
const RESPONSE_GRACE_MS = 1500;
const RELOAD_TIMEOUT_MS = 20000;

export class LocalReadError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'LocalReadError';
    this.code = code;
    this.detail = detail || null;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyAttachError(message) {
  const m = String(message || '');
  if (/No tab with (given )?id/i.test(m)) return 'tabGone';
  if (/policy/i.test(m)) return 'blockedByPolicy';
  if (/already attached/i.test(m)) return 'alreadyAttached';
  if (/chrome:\/\/|chrome-extension:\/\/|devtools:\/\/|Cannot attach|Cannot access/i.test(m)) return 'restrictedPage';
  return 'attachFailed';
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Collects TLS responses for one tab while the session is open. */
function createResponseCollector(tabId) {
  const seen = [];
  let notify = null;
  const accept = (response) => {
    if (!response || !response.securityDetails) return;
    seen.push(response);
    if (notify) notify();
  };
  const listener = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId) return;
    if (method === 'Network.responseReceived') accept(params.response);
    else if (method === 'Network.requestWillBeSent' && params.redirectResponse) accept(params.redirectResponse);
  };
  chrome.debugger.onEvent.addListener(listener);
  return {
    /** Resolves with the first TLS response from `origin`, or null on timeout. */
    waitFor(origin, timeoutMs) {
      const find = () => seen.find((r) => originOf(r.url) === origin) || null;
      return new Promise((resolve) => {
        const hit = find();
        if (hit) return resolve(hit);
        const timer = setTimeout(() => {
          notify = null;
          resolve(find());
        }, timeoutMs);
        notify = () => {
          const found = find();
          if (found) {
            clearTimeout(timer);
            notify = null;
            resolve(found);
          }
        };
      });
    },
    dispose() {
      chrome.debugger.onEvent.removeListener(listener);
    },
  };
}

function probeExpression(origin) {
  const url = JSON.stringify(`${origin}/favicon.ico`);
  return `fetch(${url} + '?ssl-checker=' + Math.random().toString(36).slice(2), {
    method: 'HEAD', cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer'
  }).then(() => 'ok', (e) => 'error:' + (e && e.message))`;
}

function pickSecurityDetails(sd) {
  return {
    protocol: sd.protocol || null,
    keyExchange: sd.keyExchange || null,
    keyExchangeGroup: sd.keyExchangeGroup || null,
    cipher: sd.cipher || null,
    mac: sd.mac || null,
    serverSignatureAlgorithm: typeof sd.serverSignatureAlgorithm === 'number' ? sd.serverSignatureAlgorithm : null,
    encryptedClientHello: sd.encryptedClientHello === true,
    certificateTransparencyCompliance: sd.certificateTransparencyCompliance || 'unknown',
    signedCertificateTimestamps: (sd.signedCertificateTimestampList || []).map((s) => ({
      status: s.status,
      origin: s.origin,
      logDescription: s.logDescription,
      logId: s.logId,
      timestamp: typeof s.timestamp === 'number' ? new Date(s.timestamp).toISOString() : null,
    })),
  };
}

/**
 * @param {number} tabId
 * @param {string} expectedOrigin  origin the popup is showing; guards against a navigation in between
 * @param {{reload?: boolean}} options  reload the page instead of probing (works with any CSP)
 */
export async function readLocalCertificate(tabId, expectedOrigin, { reload = false } = {}) {
  const debuggee = { tabId };
  try {
    await chrome.debugger.attach(debuggee, PROTOCOL_VERSION);
  } catch (e) {
    throw new LocalReadError(classifyAttachError(e && e.message), e && e.message);
  }

  let detachReason = null;
  const onDetach = (source, reason) => {
    if (source.tabId === tabId) detachReason = reason;
  };
  chrome.debugger.onDetach.addListener(onDetach);
  const collector = createResponseCollector(tabId);
  const send = (method, params) => chrome.debugger.sendCommand(debuggee, method, params);

  try {
    const { frameTree } = await send('Page.getFrameTree');
    const frame = frameTree.frame;
    const origin = originOf(frame.url);
    if (!origin || !frame.url.startsWith('https:')) throw new LocalReadError('notHttps');
    if (expectedOrigin && origin !== expectedOrigin) throw new LocalReadError('navigated');

    await send('Network.enable', {});
    await send('Network.setBypassServiceWorker', { bypass: true }).catch(() => {});

    let response;
    if (reload) {
      await send('Page.reload', {});
      response = await collector.waitFor(origin, RELOAD_TIMEOUT_MS);
    } else {
      const { executionContextId } = await send('Page.createIsolatedWorld', {
        frameId: frame.id,
        worldName: 'ssl-checker-probe',
      });
      const evaluation = send('Runtime.evaluate', {
        contextId: executionContextId,
        expression: probeExpression(origin),
        awaitPromise: true,
        returnByValue: true,
        silent: true,
      }).then((r) => (r && r.result ? r.result.value : null), () => null);
      const outcome = await Promise.race([evaluation, delay(PROBE_TIMEOUT_MS).then(() => 'timeout')]);
      response = await collector.waitFor(origin, outcome === 'ok' ? RESPONSE_GRACE_MS : 300);
    }
    if (!response) throw new LocalReadError(detachReason ? 'detached' : reload ? 'reloadFailed' : 'probeBlocked');

    const { tableNames } = await send('Network.getCertificate', { origin });
    if (!tableNames || tableNames.length === 0) throw new LocalReadError('noCertificate');

    return {
      origin,
      via: reload ? 'reload' : 'probe',
      chainBase64: tableNames,
      security: pickSecurityDetails(response.securityDetails),
      remoteAddress: response.remoteIPAddress ? { ip: response.remoteIPAddress, port: response.remotePort || null } : null,
      httpProtocol: response.protocol || null,
    };
  } catch (e) {
    if (detachReason === 'canceled_by_user') throw new LocalReadError('canceledByUser');
    if (e instanceof LocalReadError) throw e;
    if (detachReason) throw new LocalReadError('detached', e && e.message);
    throw new LocalReadError('protocolError', e && e.message);
  } finally {
    collector.dispose();
    chrome.debugger.onDetach.removeListener(onDetach);
    await chrome.debugger.detach(debuggee).catch(() => {});
  }
}
