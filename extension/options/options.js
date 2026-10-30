import { DEFAULT_NOTARY } from '../lib/default-notary.js';
import { plural, t } from '../lib/i18n.js';
import { parseKeyList } from '../lib/notary-signature.js';
import {
  getSettings,
  localReadingAvailable,
  newEndpointId,
  saveSettings,
  validateEndpointUrl,
} from '../lib/settings.js';
import { countSites, forgetAllSites } from '../lib/site-memory-store.js';
import { issuerLabel } from '../lib/verdict.js';
import { clear, h, localizeDocument } from '../ui/dom.js';
import { notaryErrorText } from '../ui/messages.js';

const $ = (id) => document.getElementById(id);
let settings = null;
let savedTimer = null;

function announce(text) {
  $('saved').textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1800);
}

async function persist(patch) {
  await saveSettings(patch);
  settings = await getSettings();
  announce(t('saved'));
}

async function renderMemoryCount() {
  const count = await countSites();
  $('memory-count').textContent = plural('memoryCount', count);
  $('forget-all').disabled = count === 0;
}

async function initMemory() {
  if (!localReadingAvailable()) {
    $('memory-panel').hidden = true; // the memory needs certificates read from the browser
    return;
  }
  $('memory-enabled').checked = settings.memoryEnabled;
  $('memory-enabled').addEventListener('change', () => persist({ memoryEnabled: $('memory-enabled').checked }));
  $('forget-all').addEventListener('click', async () => {
    await forgetAllSites();
    await renderMemoryCount();
    announce(t('forgotAll'));
  });
  await renderMemoryCount();
}

function showFormError(message) {
  const el = $('form-error');
  el.textContent = message;
  el.hidden = !message;
}

function endpointHost(url) {
  try {
    return new URL(url.replace(/\{host\}/g, 'x').replace(/\{port\}/g, '443')).host;
  } catch {
    return url;
  }
}

async function runTest(endpoint, output, button) {
  button.disabled = true;
  output.hidden = false;
  output.removeAttribute('data-tone');
  output.textContent = t('testRunning');
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'testEndpoint', endpoint });
    if (!reply || !reply.ok) {
      throw new Error(reply ? reply.error : '');
    }
    const result = reply.value;
    if (result.state === 'ok') {
      output.dataset.tone = 'ok';
      const signing = result.signed
        ? t('testSigned')
        : result.reportedKey
          ? t('testSelfSigned', [result.reportedKey])
          : t('testUnsigned');
      output.textContent = [
        t('testOk', [issuerLabel(result.chain[0]), result.vantage || '—', result.durationMs]),
        signing,
      ].join(' ');
    } else {
      output.dataset.tone = 'danger';
      output.textContent = t('testFailed', [notaryErrorText(result)]);
    }
  } catch (error) {
    output.dataset.tone = 'danger';
    output.textContent = t('testFailed', [error.message]);
  } finally {
    button.disabled = false;
  }
}

function endpointItem(endpoint) {
  const output = h('p', { class: 'endpoint-result', hidden: true, role: 'status' });
  const toggle = h('input', { type: 'checkbox', 'aria-label': t('endpointEnabled', [endpoint.name]) });
  toggle.checked = endpoint.enabled !== false;
  toggle.addEventListener('change', () =>
    persist({
      endpoints: settings.endpoints.map((e) => (e.id === endpoint.id ? { ...e, enabled: toggle.checked } : e)),
    }),
  );
  const testButton = h('button', { class: 'button', type: 'button' }, t('actionTest'));
  testButton.addEventListener('click', () => runTest(endpoint, output, testButton));
  const removeButton = h('button', { class: 'button quiet', type: 'button' }, t('actionRemove'));
  removeButton.addEventListener('click', async () => {
    await persist({ endpoints: settings.endpoints.filter((e) => e.id !== endpoint.id) });
    renderEndpoints();
  });
  const notes = [
    endpoint.token ? t('tokenSet') : null,
    endpoint.keys && endpoint.keys.length ? t('keySet') : null,
  ].filter(Boolean);
  return h(
    'li',
    { class: 'endpoint' },
    toggle,
    h(
      'div',
      {},
      h('span', { class: 'endpoint-name' }, endpoint.name),
      h('span', { class: 'endpoint-url mono' }, endpoint.url),
      notes.length ? h('span', { class: 'endpoint-token' }, notes.join(' · ')) : null,
    ),
    h('div', { class: 'endpoint-actions' }, testButton, removeButton),
    output,
  );
}

// The PlusPrivacy notary: always listed first; it can be turned off and tested, not removed.
function defaultNotaryItem() {
  const output = h('p', { class: 'endpoint-result', hidden: true, role: 'status' });
  const toggle = h('input', {
    id: 'default-notary',
    type: 'checkbox',
    'aria-label': t('endpointEnabled', [DEFAULT_NOTARY.name]),
  });
  toggle.checked = settings.defaultNotary;
  toggle.addEventListener('change', () => persist({ defaultNotary: toggle.checked }));
  const testButton = h('button', { class: 'button', type: 'button' }, t('actionTest'));
  testButton.addEventListener('click', () => runTest(DEFAULT_NOTARY, output, testButton));
  return h(
    'li',
    { class: 'endpoint' },
    toggle,
    h(
      'div',
      {},
      h('span', { class: 'endpoint-name' }, DEFAULT_NOTARY.name),
      h('span', { class: 'endpoint-url mono' }, DEFAULT_NOTARY.url),
      h('span', { class: 'endpoint-token' }, t('defaultSource')),
    ),
    h('div', { class: 'endpoint-actions' }, testButton),
    output,
  );
}

function renderEndpoints() {
  const list = clear($('endpoint-list'));
  list.append(defaultNotaryItem());
  for (const endpoint of settings.endpoints) {
    list.append(endpointItem(endpoint));
  }
}

async function onAddEndpoint(event) {
  event.preventDefault();
  const name = $('ep-name').value.trim();
  const url = $('ep-url').value.trim();
  const token = $('ep-token').value.trim();
  const valid = validateEndpointUrl(url);
  if (!valid.ok) {
    return showFormError(t(valid.error));
  }
  if (valid.url === DEFAULT_NOTARY.url || settings.endpoints.some((e) => e.url === valid.url)) {
    return showFormError(t('endpointErrorDuplicate'));
  }
  if (token && !/^[\x21-\x7e]{1,512}$/.test(token)) {
    return showFormError(t('endpointErrorToken'));
  }
  const keys = parseKeyList($('ep-key').value);
  if (!keys.ok) {
    return showFormError(t('endpointErrorKey'));
  }
  showFormError('');
  const endpoint = {
    id: newEndpointId(),
    name: name || endpointHost(valid.url),
    url: valid.url,
    token,
    keys: keys.keys,
    enabled: true,
  };
  await persist({ endpoints: [...settings.endpoints, endpoint] });
  $('endpoint-form').reset();
  renderEndpoints();
  return undefined;
}

async function init() {
  localizeDocument();
  settings = await getSettings();
  $('version').textContent = t('versionLabel', [chrome.runtime.getManifest().version]);

  if (!localReadingAvailable()) {
    $('local-unavailable').hidden = false;
    $('local-modes').disabled = true;
  }
  for (const input of document.querySelectorAll('input[name="localMode"]')) {
    input.checked = input.value === settings.localMode;
    input.addEventListener('change', () => persist({ localMode: input.value }));
  }

  $('timeout').value = String(Math.round(settings.timeoutMs / 1000));
  $('timeout').addEventListener('change', async () => {
    await persist({ timeoutMs: Number($('timeout').value) * 1000 });
    $('timeout').value = String(Math.round(settings.timeoutMs / 1000));
  });

  renderEndpoints();
  $('endpoint-form').addEventListener('submit', onAddEndpoint);
  await initMemory();
}

init();
