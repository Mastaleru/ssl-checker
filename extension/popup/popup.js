import { DEFAULT_NOTARY_HOST } from '../lib/default-notary.js';
import { formatDate, formatDateTime, formatRelative, plural, t } from '../lib/i18n.js';
import { parseTarget } from '../lib/hostnames.js';
import { getSettings, giveConsent, localReadingAvailable } from '../lib/settings.js';
import { issuerLabel, RELATION } from '../lib/verdict.js';
import { barcode, barcodeSkeleton, clear, h, icon, localizeDocument } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { localErrorText, notaryErrorText } from '../ui/messages.js';

const FRESH_MS = 5 * 60 * 1000;
const state = { tabId: null, url: null, target: null, result: null, busy: false };
const $ = (id) => document.getElementById(id);

async function call(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply || !reply.ok) {
    throw new Error(reply ? reply.error : 'No reply from the background worker');
  }
  return reply.value;
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function resolveTab() {
  // ?tabId= lets the page be opened in a tab for testing; the popup itself
  // always inspects the active tab, which activeTab grants on click.
  const params = new URLSearchParams(location.search);
  const tabParam = Number(params.get('tabId'));
  if (tabParam) {
    let url = params.get('url');
    if (!url) {
      try {
        url = (await chrome.tabs.get(tabParam)).url;
      } catch {
        url = null;
      }
    }
    return { tabId: tabParam, url };
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { tabId: tab ? tab.id : null, url: tab ? tab.url || tab.pendingUrl || null : null };
}

async function init() {
  localizeDocument();
  $('recheck').append(icon('refresh'));
  $('settings').append(icon('sliders'));
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('recheck').addEventListener('click', () =>
    check({ local: state.result && state.result.local && state.result.local.state === 'ok' ? true : undefined }),
  );

  const { tabId, url } = await resolveTab();
  state.tabId = tabId;
  state.url = url;
  state.target = url ? parseTarget(url) : null;
  if (!tabId || !state.target) {
    renderUnsupported();
    return;
  }
  renderHeader();

  const [cached, running] = await Promise.all([
    call({ type: 'cached', tabId, url }).catch(() => null),
    call({ type: 'isRunning', tabId }).catch(() => false),
  ]);
  if (cached && !running && Date.now() - Date.parse(cached.checkedAt) < FRESH_MS) {
    render(cached, false);
  } else {
    check({});
  }
}

async function check(options) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  $('recheck').disabled = true;
  renderLoading(options);
  try {
    render(await call({ type: 'check', tabId: state.tabId, url: state.url, ...options }), true);
  } catch (error) {
    renderFailure(error);
  } finally {
    state.busy = false;
    $('recheck').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Simple states
// ---------------------------------------------------------------------------

function renderHeader() {
  const { host, port, secure } = state.target;
  $('host').textContent = fmt.hostLabel(host, port);
  $('scheme').textContent = secure ? t('schemeHttps') : t('schemeHttp');
}

function renderUnsupported() {
  $('host').textContent = t('extName');
  $('scheme').textContent = '';
  $('recheck').hidden = true;
  clear($('content')).append(
    h('div', { class: 'empty-state' }, h('h2', {}, t('unsupportedTitle')), h('p', {}, t('unsupportedBody'))),
  );
}

function renderLoading(options = {}) {
  const main = clear($('content'));
  main.classList.add('loading');
  const reading = options.local === true || options.reload;
  main.append(
    h(
      'section',
      { class: 'verdict' },
      h('span', { class: 'verdict-icon' }, icon('circleDash')),
      h(
        'div',
        {},
        h('h2', {}, options.reload ? t('loadingReload') : t('loadingTitle')),
        reading ? h('p', {}, t('loadingDebuggerBar')) : null,
      ),
    ),
    h(
      'section',
      { class: 'section witnesses' },
      h('h3', {}, t('sectionWitnesses')),
      h('div', { class: 'witness' }, h('div', { class: 'witness-print' }, barcodeSkeleton())),
    ),
  );
  $('footer').hidden = true;
}

function renderFailure(error) {
  const main = clear($('content'));
  main.classList.remove('loading');
  main.append(
    h(
      'section',
      { class: 'verdict', 'data-tone': 'danger' },
      h('span', { class: 'verdict-icon' }, icon('alert')),
      h('div', {}, h('h2', {}, t('checkFailedTitle')), h('p', {}, t('checkFailedBody', [error.message]))),
    ),
  );
}

/**
 * The disclosure and agreement shown before the first check (Chrome Web Store rules:
 * prominent disclosure and affirmative consent, inside the extension, before any data
 * is handled). The choices start on; the user sees them and can turn them off first.
 */
async function renderConsent() {
  const settings = await getSettings();
  const lite = !localReadingAvailable();
  const main = clear($('content'));
  main.classList.remove('loading');
  $('footer').hidden = true;

  const notary = h('input', { type: 'checkbox', id: 'consent-notary' });
  notary.checked = settings.defaultNotary;
  const memory = h('input', { type: 'checkbox', id: 'consent-memory' });
  memory.checked = settings.memoryEnabled;
  const agree = h('button', { class: 'button primary', type: 'button' }, t('consentAgree'));
  agree.addEventListener('click', async () => {
    agree.disabled = true;
    await giveConsent({ defaultNotary: notary.checked, memoryEnabled: lite ? settings.memoryEnabled : memory.checked });
    check({});
  });

  const choice = (input, name, body) =>
    h('label', { class: 'consent-choice' }, input, h('span', {}, h('strong', {}, name), ' ', body));
  main.append(
    h(
      'section',
      { class: 'consent' },
      h('h2', {}, t('consentTitle')),
      h('p', {}, t(lite ? 'consentIntroLite' : 'consentIntro')),
      choice(notary, t('consentNotaryName'), t('consentNotaryBody', [DEFAULT_NOTARY_HOST])),
      lite ? null : choice(memory, t('consentMemoryName'), t('consentMemoryBody')),
      h('p', { class: 'consent-later' }, t('consentLater')),
      h('div', { class: 'consent-actions' }, agree),
    ),
  );
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function referenceOf(result) {
  if (result.local && result.local.state === 'ok') {
    return { chain: result.local.chain, source: 'local' };
  }
  const notary = result.notaries.find((n) => n.state === 'ok');
  return notary ? { chain: notary.chain, source: 'external', name: notary.name } : null;
}

function render(result, animate) {
  state.result = result;
  const main = clear($('content'));
  main.classList.remove('loading');
  if (result.unsupported) {
    renderUnsupported();
    return;
  }
  if (result.needsConsent) {
    renderConsent().catch(renderFailure);
    return;
  }
  main.append(verdictBlock(result));
  const warnings = warningList(result);
  if (warnings) {
    main.append(warnings);
  }
  for (const callout of callouts(result)) {
    main.append(callout);
  }
  main.append(witnessSection(result, animate));
  const history = historySection(result);
  if (history) {
    main.append(history);
  }

  const reference = referenceOf(result);
  if (reference) {
    main.append(certificateSection(reference));
    if (result.local.state === 'ok') {
      main.append(connectionSection(result.local));
    }
    if (reference.chain.length > 1) {
      main.append(chainSection(reference.chain));
    }
    main.append(detailsSection(reference, result));
  }
  renderFooter(result);
}

const VERDICT_ICONS = { ok: 'shieldCheck', info: 'info', warn: 'alert', danger: 'shieldX', neutral: 'circleDash' };

function notaryNames(r, ids) {
  return ids.map((id) => (r.notaries.find((n) => n.id === id) || { name: '?' }).name).join(', ');
}

function verdictText(r) {
  const v = r.verdict;
  const kind = v.interceptor ? t(`kind_${v.interceptor.kind}`) : '';
  switch (v.code) {
    case 'confirmed':
      return [plural('verdictConfirmedTitle', v.counts.consistent), t('verdictConfirmedBody')];
    case 'consistentSameCa':
      return [t('verdictSameCaTitle'), t('verdictSameCaBody', [v.localIssuer])];
    case 'publicLocalOnly':
      return [t('verdictPublicTitle'), t(r.endpointsConfigured ? 'verdictPublicBodyNoAnswer' : 'verdictPublicBody')];
    case 'split':
      return [
        t('verdictSplitTitle'),
        t('verdictSplitBody', [notaryNames(r, v.agreeing), v.externalIssuer, notaryNames(r, v.differing)]),
      ];
    case 'privateCa':
      return [t('verdictPrivateCaTitle'), t('verdictPrivateCaBody', [v.localIssuer])];
    case 'intercepted':
      return [
        v.interceptor ? t('verdictInterceptedByTitle', [v.interceptor.name]) : t('verdictInterceptedTitle'),
        t('verdictInterceptedBody', [v.localIssuer, v.externalIssuer]),
        v.interceptor ? t('interceptorIdentified', [v.interceptor.name, kind]) : null,
      ];
    case 'interceptorDetected':
      return [
        t('verdictInterceptedByTitle', [v.interceptor.name]),
        t('verdictInterceptorBody', [v.localIssuer]),
        t('interceptorIdentified', [v.interceptor.name, kind]),
      ];
    case 'conflictingPublic':
      return [t('verdictConflictTitle'), t('verdictConflictBody', [v.localIssuer, v.externalIssuer])];
    case 'caChangedToPrivate': {
      const change = r.memory || {};
      const previous = change.previous ? change.previous.label : '?';
      return [
        t('verdictCaChangedTitle'),
        change.sameName
          ? t('verdictCaChangedSameNameBody', [previous])
          : t('verdictCaChangedBody', [previous, v.localIssuer]),
      ];
    }
    case 'externalOnly': {
      const reason = {
        error: 'verdictExternalBodyLocalFailed',
        notRequested: 'verdictExternalBodyAsk',
        unavailable: 'verdictExternalBodyLite',
      };
      return [plural('verdictExternalTitle', v.counts.answered), t(reason[r.local.state] || 'verdictExternalBody')];
    }
    case 'externalDisagree':
      return [t('verdictExternalDisagreeTitle'), t('verdictExternalDisagreeBody')];
    case 'insecureHttp':
      return [t('verdictHttpTitle'), t(v.counts.answered ? 'verdictHttpBodyWithCert' : 'verdictHttpBody')];
    default: {
      if (r.local.state === 'error') {
        return [t('verdictNoSourcesTitle'), t('verdictNoSourcesLocalFailed')];
      }
      if (r.internal && r.endpointsConfigured) {
        return [t('verdictNoSourcesTitle'), t('verdictInternalBody')];
      }
      if (r.endpointsConfigured && r.notaries.every((n) => n.state === 'error')) {
        return [t('verdictNoSourcesTitle'), t('verdictAllSourcesFailed')];
      }
      if (r.localMode === 'ask' && r.local.state === 'notRequested') {
        return [t('verdictAskTitle'), t('verdictAskBody')];
      }
      return [t('verdictNoSourcesTitle'), t(r.localAvailable ? 'verdictNoSourcesBody' : 'verdictNoSourcesLite')];
    }
  }
}

function verdictBlock(result) {
  const [title, ...paragraphs] = verdictText(result);
  return h(
    'section',
    { class: 'verdict', 'data-tone': result.verdict.level },
    h('span', { class: 'verdict-icon' }, icon(VERDICT_ICONS[result.verdict.level] || 'circleDash')),
    h(
      'div',
      {},
      h('h2', {}, title),
      paragraphs.filter(Boolean).map((p) => h('p', {}, p)),
    ),
  );
}

function warningList(r) {
  const items = [];
  for (const w of r.verdict.warnings) {
    let entry = null;
    switch (w.code) {
      case 'expired':
        entry = ['danger', t('warnExpired')];
        break;
      case 'notYetValid':
        entry = ['danger', t('warnNotYetValid')];
        break;
      case 'expiresSoon':
        entry = ['warn', t('warnExpiresSoon', [plural('days', w.days)])];
        break;
      case 'hostMismatch':
        entry = ['danger', t('warnHostMismatch', [fmt.hostLabel(r.host, r.port)])];
        break;
      case 'weakSignature':
        entry = ['warn', t('warnWeakSignature')];
        break;
      case 'weakKey':
        entry = ['warn', t('warnWeakKey', [w.bits])];
        break;
      case 'obsoleteProtocol':
        entry = ['warn', t('warnObsoleteProtocol', [w.protocol])];
        break;
      case 'notaryUntrusted': {
        const notary = r.notaries.find((n) => n.id === w.source);
        entry = ['warn', t('warnNotaryUntrusted', [notary ? notary.name : '?', w.reason || '—'])];
        break;
      }
      case 'notPubliclyLogged':
        entry = ['info', t('warnNotPubliclyLogged')];
        break;
      case 'someSourcesDiffer':
        entry = ['info', t('warnSomeSourcesDiffer', [notaryNames(r, w.ids), w.issuer])];
        break;
      case 'caChanged':
        entry = ['warn', t('warnCaChanged', [w.previous, w.current])];
        break;
      case 'caChangedSameName':
        entry = ['warn', t('warnCaChangedSameName', [w.previous])];
        break;
      case 'caChangedPublic':
        entry = ['info', t('warnCaChangedPublic', [w.previous, w.current])];
        break;
      case 'caChangedNowPublic':
        entry = ['info', t('warnCaChangedNowPublic', [w.previous])];
        break;
      default:
        break;
    }
    if (entry) {
      items.push(entry);
    }
  }
  if (!items.length) {
    return null;
  }
  return h(
    'ul',
    { class: 'warnings' },
    items.map(([tone, text]) =>
      h('li', { 'data-tone': tone }, icon(tone === 'info' ? 'info' : 'alert'), h('span', {}, text)),
    ),
  );
}

function callouts(r) {
  const out = [];
  if (r.local.state === 'notRequested' && r.secure) {
    out.push(
      h(
        'div',
        { class: 'callout' },
        h('p', {}, t('askLocalText')),
        h(
          'button',
          { class: 'button primary', type: 'button', onclick: () => check({ local: true, reuseExternal: true }) },
          t('actionReadLocal'),
        ),
      ),
    );
  }
  if (r.local.state === 'error' && r.local.reason === 'probeBlocked') {
    out.push(
      h(
        'div',
        { class: 'callout' },
        h('p', {}, t('probeBlockedText')),
        h(
          'button',
          {
            class: 'button primary',
            type: 'button',
            onclick: () => check({ local: true, reload: true, reuseExternal: true }),
          },
          t('actionReloadAndRead'),
        ),
      ),
    );
  }
  return out;
}

// --- Witnesses -------------------------------------------------------------

const RELATION_CHIPS = {
  [RELATION.SAME_CERTIFICATE]: ['ok', 'relationSameCertificate', null],
  [RELATION.SAME_KEY]: ['ok', 'relationSameKey', null],
  [RELATION.SAME_ISSUER]: ['info', 'relationSameIssuer', 'muted'],
  [RELATION.SAME_CA]: ['info', 'relationSameCa', 'muted'],
  [RELATION.DIFFERENT]: ['danger', 'relationDifferent', 'danger'],
};

function chip(tone, text) {
  return h('span', { class: 'chip', 'data-tone': tone }, text);
}

function witness({ name, chipEl, leaf, bars, error, meta, animate }) {
  return h(
    'div',
    { class: 'witness', 'data-bars': bars || null },
    h('div', { class: 'witness-head' }, h('span', { class: 'witness-name' }, name), chipEl || null),
    leaf
      ? h(
          'div',
          { class: 'witness-print' },
          barcode(leaf.fingerprints.sha256, {
            animate,
            label: t('fingerprintLabel', [fmt.colonHex(leaf.fingerprints.sha256)]),
          }),
          h(
            'span',
            { class: 'witness-hex mono', title: fmt.colonHex(leaf.fingerprints.sha256) },
            fmt.shortFingerprint(leaf.fingerprints.sha256),
          ),
        )
      : null,
    error ? h('p', { class: 'witness-error' }, error) : null,
    meta ? h('p', { class: 'witness-meta' }, meta) : null,
  );
}

function witnessSection(r, animate) {
  const rows = [];
  const local = r.local;
  if (local.state === 'ok') {
    const via = local.via === 'reload' ? t('witnessViaReload') : null;
    const address = local.remoteAddress ? fmt.hostLabel(local.remoteAddress.ip, local.remoteAddress.port) : null;
    rows.push(
      witness({
        name: t('witnessBrowser'),
        leaf: local.chain[0],
        meta: [address, via].filter(Boolean).join(', '),
        animate,
      }),
    );
  } else if (local.state === 'error') {
    rows.push(witness({ name: t('witnessBrowser'), error: localErrorText(local) }));
  } else if (local.state === 'notRequested') {
    rows.push(witness({ name: t('witnessBrowser'), error: t('witnessLocalNotRead') }));
  }

  for (const n of r.notaries) {
    if (n.state === 'skipped') {
      continue;
    }
    if (n.state === 'error') {
      rows.push(witness({ name: n.name, error: notaryErrorText(n), meta: n.origin }));
      continue;
    }
    const comparison = r.verdict.comparisons.find((c) => c.id === n.id);
    const [tone, key, bars] = comparison ? RELATION_CHIPS[comparison.relation] : [null, null, null];
    const issuer =
      comparison && comparison.relation !== RELATION.SAME_CERTIFICATE
        ? t('witnessIssuedBy', [issuerLabel(n.chain[0])])
        : null;
    rows.push(
      witness({
        name: n.name,
        chipEl: key ? chip(tone, t(key)) : null,
        leaf: n.chain[0],
        bars,
        meta: [n.vantage, n.address, t('durationMs', [n.durationMs]), issuer].filter(Boolean).join(', '),
        animate,
      }),
    );
  }

  const section = h('section', { class: 'section witnesses' }, h('h3', {}, t('sectionWitnesses')), rows);
  if (r.internal && r.endpointsConfigured) {
    section.append(h('p', { class: 'witness-note' }, t('externalSkippedInternal')));
  }
  if (!r.endpointsConfigured) {
    section.append(
      h('p', { class: 'witness-note' }, t(r.localAvailable ? 'noSourcesNote' : 'noSourcesNoteLite')),
      h(
        'button',
        { class: 'button quiet', type: 'button', onclick: () => chrome.runtime.openOptionsPage() },
        t('actionAddSource'),
      ),
    );
  }
  return section;
}

// --- Site memory --------------------------------------------------------------

async function memoryAction(type, button) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  button.disabled = true;
  try {
    render(await call({ type, tabId: state.tabId, url: state.url }), false);
  } catch (error) {
    renderFailure(error);
  } finally {
    state.busy = false;
  }
}

function historySection(r) {
  const m = r.memory;
  if (m && m.status === 'incognito') {
    return h(
      'section',
      { class: 'section history' },
      h('h3', {}, t('sectionHistory')),
      h('p', {}, t('historyIncognito')),
    );
  }
  if (!m || !['first', 'known', 'changed', 'forgotten'].includes(m.status)) {
    return null;
  }
  const lines = [];
  const actions = [];
  const forgetButton = () => {
    const button = h('button', { class: 'button quiet', type: 'button' }, t('actionForgetSite'));
    button.addEventListener('click', () => memoryAction('forgetSite', button));
    return button;
  };

  if (m.status === 'forgotten') {
    lines.push(t('historyForgotten'));
  } else if (m.trusted) {
    lines.push(t('historyTrusted', [m.current.label]));
    actions.push(forgetButton());
  } else if (m.status === 'first') {
    lines.push(t('historyFirst', [m.current.label]));
    actions.push(forgetButton());
  } else if (m.status === 'known') {
    lines.push(t('historyKnown', [m.current.label, plural('checks', m.entry.count), formatDate(m.entry.firstSeen)]));
    actions.push(forgetButton());
  } else if (m.learned) {
    lines.push(t('historyLearned', [m.current.label]));
    actions.push(forgetButton());
  } else {
    const p = m.previous;
    if (p) {
      lines.push(t('historyChangedBefore', [p.label, plural('checks', p.count), formatDate(p.lastSeen)]));
    }
    lines.push(t('historyChangedNow', [m.current.label]));
    if (m.sameName) {
      lines.push(t('historySameName'));
    }
    const trust = h('button', { class: 'button', type: 'button' }, t('actionTrustCa'));
    trust.addEventListener('click', () => memoryAction('trustCa', trust));
    actions.push(trust, forgetButton());
  }

  return h(
    'section',
    { class: 'section history' },
    h('h3', {}, t('sectionHistory')),
    lines.map((text) => h('p', {}, text)),
    actions.length ? h('div', { class: 'history-actions' }, actions) : null,
  );
}

// --- Certificate summary ------------------------------------------------------

function facts(pairs) {
  const dl = h('dl', { class: 'facts' });
  for (const [label, value] of pairs) {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    dl.append(h('dt', {}, label), h('dd', {}, value));
  }
  return dl;
}

function validityBlock(cert) {
  const v = fmt.validity(cert);
  const tone = v.state === 'expired' || v.state === 'future' ? 'danger' : v.state === 'soon' ? 'warn' : 'ok';
  const note =
    v.state === 'expired'
      ? t('validityExpired', [plural('days', Math.abs(v.days))])
      : v.state === 'future'
        ? t('validityFuture')
        : t('validityRemaining', [plural('days', v.days)]);
  return h(
    'div',
    { 'data-tone': tone },
    `${formatDate(cert.notBefore)} – ${formatDate(cert.notAfter)}`,
    h(
      'span',
      { class: 'validity-track', 'aria-hidden': 'true' },
      h('span', { style: `width:${Math.round(v.fraction * 100)}%` }),
    ),
    h('span', { class: 'validity-note' }, note),
  );
}

function certificateSection(reference) {
  const leaf = reference.chain[0];
  const names = fmt.primaryNames(leaf);
  const org = [leaf.subject.organization, leaf.subject.locality, leaf.subject.country].filter(Boolean).join(', ');
  const level = leaf.extensions.validationLevel;
  const type = [level ? t(`level_${level}`) : null, fmt.keyLabel(leaf.publicKey), leaf.signatureAlgorithm.name]
    .filter(Boolean)
    .join(', ');
  const heading =
    reference.source === 'local' ? t('sectionCertificate') : t('sectionCertificateExternal', [reference.name]);
  return h(
    'section',
    { class: 'section' },
    h('h3', {}, heading),
    facts([
      [
        t('certIssuedTo'),
        names.length > 1
          ? [names[0], ' ', h('span', { class: 'subtle' }, t('andMore', [names.length - 1]))]
          : names[0] || fmt.subjectLabel(leaf),
      ],
      [t('certOrganization'), org],
      [t('certIssuedBy'), issuerLabel(leaf)],
      [t('certValidity'), validityBlock(leaf)],
      [t('certType'), type],
    ]),
  );
}

function ctChip(status) {
  const map = { compliant: ['ok', 'ctCompliant'], 'not-compliant': ['warn', 'ctNotCompliant'] };
  const [tone, key] = map[status] || ['neutral', 'ctUnknown'];
  return chip(tone, t(key));
}

function connectionSection(local) {
  const s = local.security;
  const validScts = s.signedCertificateTimestamps.filter((x) => x.status === 'Verified').length;
  return h(
    'section',
    { class: 'section' },
    h('h3', {}, t('sectionConnection')),
    facts([
      [t('connProtocol'), [s.protocol, local.httpProtocol ? ` (${local.httpProtocol})` : ''].join('')],
      [t('connKeyExchange'), s.keyExchangeGroup || s.keyExchange],
      [t('connCipher'), [s.cipher, s.mac ? ` / ${s.mac}` : ''].join('')],
      [t('connCT'), [ctChip(s.certificateTransparencyCompliance), validScts ? ` ${plural('scts', validScts)}` : '']],
      [t('connECH'), s.encryptedClientHello ? t('yes') : t('no')],
    ]),
  );
}

function chainSection(chain) {
  return h(
    'details',
    { class: 'section' },
    h('summary', {}, t('sectionChain', [chain.length])),
    h(
      'ol',
      { class: 'chain' },
      chain.map((cert, i) =>
        h(
          'li',
          {},
          h(
            'div',
            { class: 'chain-name' },
            fmt.subjectLabel(cert),
            chip('neutral', i === 0 ? t('chainLeaf') : cert.selfIssued ? t('chainRoot') : t('chainIntermediate')),
          ),
          h('div', { class: 'chain-meta' }, t('chainIssuedBy', [issuerLabel(cert)])),
          h(
            'div',
            { class: 'chain-meta' },
            `${formatDate(cert.notBefore)} – ${formatDate(cert.notAfter)}, ${fmt.keyLabel(cert.publicKey)}`,
          ),
        ),
      ),
    ),
  );
}

function list(items, mono = false) {
  if (!items || !items.length) {
    return null;
  }
  return h(
    'ul',
    { class: 'list' },
    items.map((x) => h('li', { class: mono ? 'wrap-mono' : null }, x)),
  );
}

function detailsSection(reference, result) {
  const leaf = reference.chain[0];
  const e = leaf.extensions;
  const san = e.subjectAltName;
  const sanItems = san ? [...san.dns, ...san.ip, ...san.email, ...san.uri, ...san.directoryName] : [];
  const security = result.local && result.local.state === 'ok' ? result.local.security : null;
  const sctItems = security
    ? security.signedCertificateTimestamps.map((s) => `${s.logDescription || s.logId} (${s.origin}, ${s.status})`)
    : (e.scts || []).map((s) => `${s.logId} (${formatDateTime(s.timestamp)})`);

  const copyButton = h('button', { class: 'button quiet', type: 'button' }, icon('copy'), t('actionCopyPem'));
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fmt.chainToPem([leaf]));
      copyButton.lastChild.textContent = t('copied');
    } catch {
      copyButton.lastChild.textContent = t('copyFailed');
    }
  });
  const downloadButton = h(
    'button',
    { class: 'button quiet', type: 'button' },
    icon('download'),
    t('actionDownloadChain'),
  );
  downloadButton.addEventListener('click', () => {
    const blob = new Blob([fmt.chainToPem(reference.chain)], { type: 'application/x-pem-file' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${result.host}-chain.pem` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  return h(
    'details',
    { class: 'section' },
    h('summary', {}, t('sectionDetails')),
    facts([
      ['SHA-256', h('span', { class: 'wrap-mono' }, fmt.colonHex(leaf.fingerprints.sha256))],
      ['SHA-1', h('span', { class: 'wrap-mono' }, fmt.colonHex(leaf.fingerprints.sha1))],
      [t('detailSpkiPin'), h('span', { class: 'wrap-mono' }, `sha256/${leaf.fingerprints.spkiSha256}`)],
      [
        t('detailSerial'),
        h(
          'span',
          { class: 'wrap-mono' },
          fmt.colonHex(leaf.serialNumber.length % 2 ? `0${leaf.serialNumber}` : leaf.serialNumber),
        ),
      ],
      [t('detailSignature'), leaf.signatureAlgorithm.name],
      [
        t('detailPublicKey'),
        [fmt.keyLabel(leaf.publicKey), leaf.publicKey.exponent ? ` (e=${leaf.publicKey.exponent})` : ''].join(''),
      ],
      [t('detailServerSignature'), security ? fmt.tlsSignatureScheme(security.serverSignatureAlgorithm) : null],
      [plural('detailNames', sanItems.length), list(sanItems, true)],
      [t('detailKeyUsage'), e.keyUsage ? e.keyUsage.join(', ') : null],
      [t('detailExtKeyUsage'), e.extKeyUsage ? e.extKeyUsage.map((x) => x.name).join(', ') : null],
      [t('detailPolicies'), list((e.policies || []).map((p) => p.name))],
      ['OCSP', list(e.ocsp, true)],
      [t('detailCaIssuers'), list(e.caIssuers, true)],
      ['CRL', list(e.crl, true)],
      [t('detailScts'), list(sctItems)],
      [t('detailMustStaple'), e.mustStaple ? t('yes') : null],
      [t('detailExtensions'), list(e.list.map((x) => `${x.name || x.oid}${x.critical ? ` (${t('critical')})` : ''}`))],
    ]),
    h('div', { class: 'detail-actions' }, copyButton, downloadButton),
  );
}

function renderFooter(result) {
  const footer = clear($('footer'));
  footer.hidden = false;
  footer.append(
    h('span', { title: formatDateTime(result.checkedAt) }, t('checkedAt', [formatRelative(result.checkedAt)])),
  );
}

init().catch((error) => renderFailure(error));
