#!/usr/bin/env node
// End-to-end tests: loads the real extension into Chromium and drives the popup
// and the options page against local TLS servers and real notary processes.
//
// Needs Playwright, the notary's packages, and a Chromium that can load unpacked
// extensions (Chromium or Chrome for Testing; branded Google Chrome ignores
// --load-extension since 137).
//   npm ci && npx playwright install chromium && npm ci --prefix notary
//   node tests/e2e/run.mjs                 (E2E_LANG=ro for the Romanian UI)
// Optional: CHROME_PATH=<chrome binary>, PLAYWRIGHT_MODULE=<path to playwright>,
//           E2E_OUT=<folder for screenshots>, E2E_ONLY=<scenario name substring>
// Without CHROME_PATH, Playwright's full Chromium runs in its new headless mode
// (channel "chromium"): its default headless shell cannot load extensions.
// The notaries reach the real site at 127.0.0.2 (tests/e2e/notary-hosts.mjs). Linux and
// Windows answer on all of 127.0.0.0/8; on macOS, add it first: sudo ifconfig lo0 alias 127.0.0.2

import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageVariant } from '../../scripts/build.mjs';
import { CONSENT_VERSION } from '../../extension/lib/settings.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TLS = path.join(ROOT, 'tests/fixtures/tls');
const LANG = process.env.E2E_LANG || 'en';
const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests/e2e/output', LANG);
const ONLY = process.env.E2E_ONLY || '';
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' };
const HOST = 'www.example.com';
const messages = JSON.parse(readFileSync(path.join(ROOT, 'extension/_locales', LANG, 'messages.json'), 'utf8'));
const msg = (key, ...subs) => subs.reduce((m, s, i) => m.replace(`$${i + 1}`, s), messages[key].message);

const read = (f) => readFileSync(path.join(TLS, f));
const spkiPin = (pem) =>
  createHash('sha256')
    .update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
const pemBodies = (pem) =>
  [...pem.toString().matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END/g)].map((m) => m[1].replace(/\s+/g, ''));

/** A signing key for a test notary, in a file as SIGNING_KEY_FILE expects it. */
function signingKey(dir, name) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const file = path.join(dir, `${name}.pem`);
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { file, publicKey: `ed25519:${publicKey.export({ format: 'jwk' }).x}` };
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function siteHandler(req, res) {
  const { pathname } = new URL(req.url, 'https://x');
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  if (pathname === '/csp') {
    headers['content-security-policy'] = "default-src 'none'";
  }
  res.writeHead(200, headers);
  res.end(`<!doctype html><title>Test site</title><h1>${pathname === '/csp' ? 'Strict CSP page' : 'Test site'}</h1>`);
}

async function listen(server, port = null, address = '127.0.0.1') {
  const chosen = port || (await freePort());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(chosen, address, resolve);
  });
  return chosen;
}

async function startNotary(env) {
  if (!existsSync(path.join(ROOT, 'notary/node_modules/express'))) {
    throw new Error('The notary needs its packages first: npm ci --prefix notary');
  }
  const port = await freePort();
  const hosts = pathToFileURL(path.join(ROOT, 'tests/e2e/notary-hosts.mjs')).href;
  const child = spawn(process.execPath, ['--import', hosts, path.join(ROOT, 'notary/src/main.js')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', NOTARY_NAME: 'Test vantage', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
    child.once('exit', (code) => reject(new Error(`notary exited with ${code}`)));
  });
  return { port, child };
}

// Points the staged extension's PlusPrivacy notary at a local one, with that one's keys,
// and the Test button in Options at the local test site.
function pointDefaultNotary(extDir, url, keys, testSite) {
  const file = path.join(extDir, 'lib/default-notary.js');
  const site = `Object.freeze(${JSON.stringify(testSite)})`;
  const changed = readFileSync(file, 'utf8')
    .replace("'https://notary.plusprivacy.com/v1/cert'", `'${url}'`)
    .replace(/keys: Object\.freeze\(\[[^\]]*\]\)/, `keys: Object.freeze(${JSON.stringify(keys)})`)
    .replace(/NOTARY_TEST_SITE = Object\.freeze\(\{[^}]*\}\)/, `NOTARY_TEST_SITE = ${site}`);
  if (!changed.includes(url) || !changed.includes(keys[0]) || !changed.includes(site)) {
    throw new Error('lib/default-notary.js no longer holds the PlusPrivacy URL, keys and test site');
  }
  writeFileSync(file, changed);
  return extDir;
}

/**
 * Sits between the extension and the PlusPrivacy stand-in, where an interceptor on the
 * user's network would be. Its `mode` decides what it does to the next requests:
 *   pass            changes nothing (and keeps the last answer, for replay)
 *   forgeChain      puts the interceptor's own chain into the answer
 *   swapTarget      sends the notary to look at the interceptor's own server, keeping the nonce
 *   replay          answers with an earlier genuine answer
 *   stripSignature  drops the Notary-Signature header
 *   spoofError      answers with an error that claims the extension's own "tampered" code
 * CORS preflights always go through unchanged.
 */
async function startTamperProxy(upstreamPort, { forgedChain }) {
  const proxy = { mode: 'pass', captured: null };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    let sent = Buffer.concat(chunks);
    const tamper = req.method !== 'OPTIONS';
    if (tamper) {
      proxy.lastRequest = { method: req.method, url: req.url, body: sent.toString() };
    }
    if (tamper && proxy.mode === 'replay' && proxy.captured) {
      res.writeHead(200, proxy.captured.headers);
      res.end(proxy.captured.body);
      return;
    }
    if (tamper && proxy.mode === 'spoofError') {
      res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ version: 1, error: { code: 'tampered', message: 'Call 0800 000 000 now' } }));
      return;
    }
    if (tamper && proxy.mode === 'swapTarget') {
      // The interceptor's own server answers at 127.0.0.1, on the port that was asked.
      sent = Buffer.from(JSON.stringify({ ...JSON.parse(sent), host: '127.0.0.1' }));
    }
    const sentHeaders = { ...req.headers, 'content-length': String(sent.length) };
    delete sentHeaders['transfer-encoding'];
    const upstream = http.request(
      { host: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: sentHeaders },
      (answer) => {
        const chunks = [];
        answer.on('data', (chunk) => chunks.push(chunk));
        answer.on('end', () => {
          let body = Buffer.concat(chunks);
          const ok = answer.statusCode === 200;
          if (ok && proxy.mode === 'forgeChain') {
            body = Buffer.from(JSON.stringify({ ...JSON.parse(body), chain: forgedChain }));
          }
          const headers = { ...answer.headers, 'content-length': String(body.length) };
          delete headers['transfer-encoding'];
          if (proxy.mode === 'stripSignature') {
            delete headers['notary-signature'];
          }
          if (ok && proxy.mode === 'pass') {
            proxy.captured = { headers, body };
          }
          res.writeHead(answer.statusCode, headers);
          res.end(body);
        });
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    upstream.end(sent);
  });
  proxy.port = await listen(server);
  proxy.close = () => server.close();
  return proxy;
}

// ---------------------------------------------------------------------------

class Harness {
  /** @param {{incognito?: boolean}} options  incognito: load the extension allowed in incognito windows */
  constructor(extDir, args, { incognito = false } = {}) {
    this.extDir = extDir;
    this.args = args;
    this.incognito = incognito;
    this.errors = [];
  }

  async start() {
    this.profile = mkdtempSync(path.join(os.tmpdir(), 'sslc-profile-'));
    const common = ['--headless=new', `--lang=${LANG}`, '--no-proxy-server', ...this.args];
    if (!this.incognito) {
      this.ctx = await chromium.launchPersistentContext(this.profile, {
        ...BROWSER,
        headless: true,
        args: [`--disable-extensions-except=${this.extDir}`, `--load-extension=${this.extDir}`, ...common],
      });
      [this.sw] = this.ctx.serviceWorkers();
      if (!this.sw) {
        this.sw = await this.ctx.waitForEvent('serviceworker');
      }
    } else {
      // --load-extension cannot allow incognito, and the chrome://extensions toggle
      // disables a command-line extension, so load it through CDP instead.
      const port = await freePort();
      this.ctx = await chromium.launchPersistentContext(this.profile, {
        ...BROWSER,
        headless: true,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: ['--enable-unsafe-extension-debugging', `--remote-debugging-port=${port}`, ...common],
      });
      this.cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const cdp = await this.cdpBrowser.newBrowserCDPSession();
      const started = this.ctx.waitForEvent('serviceworker', { timeout: 15000 });
      const { id } = await cdp.send('Extensions.loadUnpacked', { path: this.extDir, enableInIncognito: true });
      this.sw = this.ctx.serviceWorkers().find((w) => w.url().includes(id)) || (await started);
    }
    this.extId = new URL(this.sw.url()).host;
    return this;
  }

  async stop() {
    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => {});
    }
    await this.ctx.close();
    rmSync(this.profile, { recursive: true, force: true });
  }

  /** Opens `url` in a new incognito window and returns its tab id once loaded. */
  async openIncognitoTab(url) {
    return this.sw.evaluate(async (target) => {
      const win = await chrome.windows.create({ incognito: true, url: target });
      const tabId = win.tabs[0].id;
      for (let i = 0; i < 100; i++) {
        // Without the "tabs" permission tab.url is hidden; the debugger target has it.
        const tab = await chrome.tabs.get(tabId);
        const page = (await chrome.debugger.getTargets()).find((t) => t.tabId === tabId);
        if (tab.status === 'complete' && page && page.url.startsWith(target)) {
          return tabId;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('incognito tab did not load');
    }, url);
  }

  watch(page, label) {
    page.on('console', (m) => m.type() === 'error' && this.errors.push(`${label}: ${m.text()}`));
    page.on('pageerror', (e) => this.errors.push(`${label}: ${e}`));
  }

  /**
   * Starts a scenario from clean storage. Unless the scenario says otherwise, the
   * user has already agreed in the popup and turned the PlusPrivacy notary off;
   * a value of null leaves that setting at its default.
   */
  async settings(values) {
    const all = {
      consent: { version: CONSENT_VERSION, at: '2026-01-01T00:00:00.000Z' },
      defaultNotary: false,
      ...values,
    };
    await this.sw.evaluate(async (v) => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      await chrome.storage.local.set(Object.fromEntries(Object.entries(v).filter(([, value]) => value !== null)));
    }, all);
  }

  async tabIdFor(page) {
    // Any tab id works for the popup; with the debugger permission we can look it up by URL.
    return this.sw.evaluate(async (url) => {
      if (chrome.debugger) {
        const target = (await chrome.debugger.getTargets()).find((t) => t.type === 'page' && t.url === url);
        if (target) {
          return target.tabId;
        }
      }
      const tabs = await chrome.tabs.query({});
      return tabs[tabs.length - 1].id;
    }, page.url());
  }

  async openPopup(url, { settings, shot } = {}) {
    if (settings) {
      await this.settings(settings);
    }
    const page = await this.ctx.newPage();
    if (/^https?:/.test(url)) {
      await page.goto(url, { waitUntil: 'load' });
    }
    const tabId = await this.tabIdFor(page);
    const popup = await this.ctx.newPage();
    this.watch(popup, `popup(${url})`);
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${this.extId}/popup/popup.html?tabId=${tabId}&url=${encodeURIComponent(url)}`);
    const view = new PopupView(this, popup, page, tabId, shot);
    await view.settle();
    return view;
  }
}

class PopupView {
  constructor(h, popup, page, tabId, shot) {
    Object.assign(this, { h, popup, page, tabId, shot });
  }

  async settle() {
    await this.popup.waitForSelector('#content:not(.loading) .verdict, .empty-state, .consent', { timeout: 40000 });
    await this.popup.waitForTimeout(800); // let the barcode animation finish before screenshots
  }

  async result() {
    return this.h.sw.evaluate(
      async (id) => (await chrome.storage.session.get(`result:${id}`))[`result:${id}`],
      this.tabId,
    );
  }

  async badge() {
    return this.h.sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), this.tabId);
  }

  async ui() {
    return this.popup.evaluate(() => ({
      tone: document.querySelector('.verdict')?.dataset.tone || null,
      title: document.querySelector('.verdict h2, .empty-state h2')?.textContent || '',
      body: [...document.querySelectorAll('.verdict p')].map((p) => p.textContent).join(' '),
      witnesses: [...document.querySelectorAll('.witness')].map((w) => ({
        name: w.querySelector('.witness-name')?.textContent,
        chip: w.querySelector('.chip')?.textContent || null,
        hasBarcode: Boolean(w.querySelector('svg.barcode')),
        error: w.querySelector('.witness-error')?.textContent || null,
        meta: w.querySelector('.witness-meta')?.textContent || null,
      })),
      warnings: [...document.querySelectorAll('.warnings li')].map((li) => li.textContent),
      buttons: [...document.querySelectorAll('#content button')].map((b) => b.textContent),
      notes: [...document.querySelectorAll('.witness-note')].map((n) => n.textContent),
      history: [...document.querySelectorAll('.history p')].map((p) => p.textContent),
    }));
  }

  /** Clicks a history button and waits until the history shows `expected`. */
  async historyAction(label, expected) {
    await this.popup.getByRole('button', { name: label }).click();
    await this.popup.waitForFunction(
      (text) => [...document.querySelectorAll('.history p')].some((p) => p.textContent === text),
      expected,
      { timeout: 10000 },
    );
  }

  async click(label) {
    await this.popup.getByRole('button', { name: label }).click();
    await this.settle();
  }

  async snap(suffix = '') {
    if (!this.shot) {
      return;
    }
    mkdirSync(OUT, { recursive: true });
    await this.popup.evaluate(() => window.scrollTo(0, 0)); // the sticky header would land mid-page otherwise
    await this.popup.screenshot({ path: path.join(OUT, `${this.shot}${suffix}.png`), fullPage: true });
  }

  async close() {
    await this.popup.close();
    if (this.page) {
      await this.page.close();
    }
  }
}

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? '' : `\n${JSON.stringify(details, null, 2)}`}`);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const siteChain = read('site-chain.pem');
  const interceptChain = read('intercept-chain.pem');
  const site = https.createServer({ key: read('site-leaf.key'), cert: siteChain }, siteHandler);
  const intercept = https.createServer({ key: read('intercept-leaf.key'), cert: interceptChain }, siteHandler);
  const plain = http.createServer(siteHandler);
  // One more site whose certificate can be swapped, for the site memory: the
  // same host and port first serves the "real" chain, then the interceptor's.
  const memorySite = https.createServer({ key: read('site-leaf.key'), cert: siteChain }, siteHandler);
  const serveOnMemorySite = (key, cert) => {
    memorySite.setSecureContext({ key, cert }); // new ticket keys too, so no session resumption
    memorySite.closeAllConnections();
  };
  const sitePort = await listen(site);
  const interceptPort = await listen(intercept);
  const plainPort = await listen(plain);
  const memoryPort = await listen(memorySite);
  // The real site as the notaries see it (tests/e2e/notary-hosts.mjs): at 127.0.0.2, on
  // both ports, so that a notary still meets the real certificate where the browser meets
  // the interceptor's.
  const elsewhere = [];
  for (const port of [sitePort, interceptPort]) {
    const server = https.createServer({ key: read('site-leaf.key'), cert: siteChain }, siteHandler);
    await listen(server, port, '127.0.0.2');
    elsewhere.push(server);
  }
  const closedPort = await freePort();
  const TOKEN = 'e2e-secret-token-for-a-private-notary';
  const notaryEnv = {
    ALLOW_PRIVATE: '1',
    ALLOWED_PORTS: `${sitePort},${interceptPort}`,
    RATE_LIMIT: '0',
    BAN_STRIKES: '1000',
    CACHE_SECONDS: '0',
  };
  const keyDir = mkdtempSync(path.join(os.tmpdir(), 'sslc-keys-'));
  const keys = { own: signingKey(keyDir, 'own'), plusPrivacy: signingKey(keyDir, 'plusprivacy') };
  const notary = await startNotary({ ...notaryEnv, NOTARY_TOKEN: TOKEN, SIGNING_KEY_FILE: keys.own.file });
  // The stand-in for the PlusPrivacy notary: public, without a token, behind the
  // proxy that plays the interceptor.
  const publicNotary = await startNotary({ ...notaryEnv, SIGNING_KEY_FILE: keys.plusPrivacy.file });
  const tamper = await startTamperProxy(publicNotary.port, { forgedChain: pemBodies(interceptChain) });

  // A notary endpoint that always looks at the given local port: the extension
  // asks about www.example.com, the notary checks 127.0.0.1:<port>. Pointing it
  // at the "real" server while the browser visits the "intercepting" one
  // reproduces two different network paths on one machine. The token makes
  // every request go through a CORS preflight, as with a real protected notary,
  // and the key makes the extension check every answer's signature.
  // The address, not "localhost": the notary connects to the first address a name
  // resolves to, which is ::1 on GitHub's runners and on Windows, and the sites
  // listen on 127.0.0.1 only.
  const endpoint = (id, name, port, token = TOKEN) => ({
    id,
    name,
    url: `http://127.0.0.1:${notary.port}/v1/cert?host=127.0.0.1&port=${port}&for={host}`,
    token,
    keys: [keys.own.publicKey],
    enabled: true,
  });
  const outside = endpoint('outside', 'Notary outside', sitePort);
  const inside = endpoint('inside', 'Notary inside your network', interceptPort);
  const siteUrl = `https://${HOST}:${sitePort}/`;
  const interceptedUrl = `https://${HOST}:${interceptPort}/`;

  const args = [
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1, MAP example.com 127.0.0.1`,
    `--ignore-certificate-errors-spki-list=${spkiPin(siteChain)},${spkiPin(interceptChain)}`,
  ];

  const fullDir = stageVariant('full', mkdtempSync(path.join(os.tmpdir(), 'sslc-full-')));
  // A plain address, as the real one: the extension posts the site to it.
  pointDefaultNotary(fullDir, `http://127.0.0.1:${tamper.port}/v1/cert`, [keys.plusPrivacy.publicKey], {
    host: HOST,
    port: sitePort,
  });
  const full = await new Harness(fullDir, args).start();
  const scenarios = [
    [
      'confirmed by a notary',
      async () => {
        const v = await full.openPopup(siteUrl, {
          settings: { localMode: 'always', endpoints: [outside] },
          shot: 'confirmed',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(r.verdict.code === 'confirmed' && ui.tone === 'ok', 'expected confirmed/ok', {
          verdict: r.verdict.code,
          ui,
        });
        assert(
          r.local.state === 'ok' && r.local.via === 'probe' && r.local.chain.length === 2,
          'local read through the probe',
          r.local,
        );
        assert(
          ui.witnesses.length === 2 && ui.witnesses[1].chip === msg('relationSameCertificate'),
          'identical notary row',
          ui.witnesses,
        );
        assert(ui.title === msg('verdictConfirmedTitleOne', '1'), 'title', ui.title);
        assert((await v.badge()) === '✓', 'green badge on the icon', await v.badge());
        for (const summary of await v.popup.$$('details > summary')) {
          await summary.click();
        }
        await v.snap('-details');
        const details = await v.popup.evaluate(() =>
          [...document.querySelectorAll('details .facts dt')].map((dt) => dt.textContent),
        );
        assert(
          details.includes('SHA-256') && details.includes('OCSP') && details.includes('CRL'),
          'technical details listed',
          details,
        );
        await v.close();
      },
    ],
    [
      'first run: agreement, then the PlusPrivacy notary',
      async () => {
        let v = await full.openPopup(siteUrl, { settings: { consent: null, defaultNotary: null }, shot: 'consent' });
        const shown = await v.popup.evaluate(() => ({
          title: document.querySelector('.consent h2')?.textContent,
          choices: [...document.querySelectorAll('.consent input[type=checkbox]')].map((c) => c.checked),
        }));
        await v.snap();
        assert(
          shown.title === msg('consentTitle') && shown.choices.join() === 'true,true',
          'agreement shown, both choices on',
          shown,
        );
        assert(!(await v.result()), 'nothing checked before agreeing');
        await v.click(msg('consentAgree'));
        const r = await v.result();
        assert(
          r.verdict.code === 'confirmed' &&
            r.notaries[0].id === 'plusprivacy' &&
            r.notaries[0].state === 'ok' &&
            r.notaries[0].signed === true,
          'checked with the PlusPrivacy notary, whose answer is signed',
          { verdict: r.verdict.code, notaries: r.notaries },
        );
        const stored = await full.sw.evaluate(() =>
          chrome.storage.local.get(['consent', 'defaultNotary', 'memoryEnabled']),
        );
        assert(
          stored.consent?.version === CONSENT_VERSION && stored.defaultNotary === true && stored.memoryEnabled === true,
          'agreement saved',
          stored,
        );
        await v.close();

        v = await full.openPopup(siteUrl, { settings: { consent: null, defaultNotary: null } });
        await v.popup.uncheck('#consent-notary');
        await v.click(msg('consentAgree'));
        const without = await v.result();
        assert(without.endpointsConfigured === 0 && without.notaries.length === 0, 'no notary asked', without.notaries);
        const saved = await full.sw.evaluate(() => chrome.storage.local.get('defaultNotary'));
        assert(saved.defaultNotary === false, 'choice saved', saved);
        await v.close();
      },
    ],
    [
      'PlusPrivacy answers: signed, or changed on the way',
      async () => {
        const settings = { localMode: 'always', endpoints: [], defaultNotary: true };
        tamper.mode = 'pass';
        let v = await full.openPopup(siteUrl, { settings, shot: 'signed' });
        let r = await v.result();
        let ui = await v.ui();
        await v.snap();
        assert(r.verdict.code === 'confirmed' && r.notaries[0].signed === true, 'signed answer verified', {
          verdict: r.verdict.code,
          notary: r.notaries[0],
        });
        assert(ui.witnesses[1].meta.includes(msg('witnessSigned')), 'signed answer noted', ui.witnesses[1]);
        // What the extension sent: the site in a POST body, and nothing about it in the URL.
        const sent = tamper.lastRequest;
        const question = JSON.parse(sent.body);
        assert(
          sent.method === 'POST' && sent.url === '/v1/cert' && question.host === HOST && question.port === sitePort,
          'the site travels in a POST body, not in the URL',
          sent,
        );
        assert(/^[A-Za-z0-9_-]{16,128}$/.test(question.nonce), 'a nonce in the body', sent);
        await v.close();

        // What an interceptor would want: the notary seeming to see the interceptor's
        // certificate. Each way of faking that breaks the signature check.
        for (const [mode, url, reason] of [
          ['forgeChain', interceptedUrl, 'signature'],
          ['swapTarget', interceptedUrl, 'target'],
          ['replay', siteUrl, 'nonce'],
        ]) {
          tamper.mode = mode;
          v = await full.openPopup(url, { settings, shot: `tampered-${mode}` });
          r = await v.result();
          ui = await v.ui();
          await v.snap();
          const answer = r.notaries[0];
          assert(
            answer.state === 'error' && answer.error.code === 'tampered' && answer.error.reason === reason,
            `${mode}: the answer is refused`,
            answer,
          );
          assert(
            r.verdict.code === 'notaryTampered' && ui.tone === 'danger' && ui.title === msg('verdictTamperedTitle'),
            `${mode}: the verdict says the answer was changed`,
            { verdict: r.verdict.code, ui },
          );
          assert(ui.witnesses[1].error === msg('notaryErr_tampered'), `${mode}: witness row`, ui.witnesses[1]);
          assert((await v.badge()) === '!', `${mode}: red badge`, await v.badge());
          await v.close();
        }

        // Without a signature the answer is not used either, but nothing proves tampering.
        tamper.mode = 'stripSignature';
        v = await full.openPopup(siteUrl, { settings });
        r = await v.result();
        ui = await v.ui();
        assert(r.notaries[0].error?.code === 'unsigned' && r.verdict.code === 'privateCa', 'unsigned answer refused', {
          notary: r.notaries[0],
          verdict: r.verdict.code,
        });
        assert(ui.witnesses[1].error === msg('notaryErr_unsigned'), 'unsigned text', ui.witnesses[1]);
        await v.close();

        // An error body is not signed: it cannot claim the extension's own codes, nor show its text.
        tamper.mode = 'spoofError';
        v = await full.openPopup(siteUrl, { settings });
        r = await v.result();
        ui = await v.ui();
        assert(
          r.notaries[0].error?.code === 'http' && r.verdict.code === 'privateCa' && !r.verdict.tampered,
          'a spoofed "tampered" error is an ordinary failure',
          { notary: r.notaries[0], verdict: r.verdict.code },
        );
        assert(ui.witnesses[1].error === msg('notaryErr_http', '502'), 'spoofed error text', ui.witnesses[1]);
        await v.close();
        tamper.mode = 'pass';
      },
    ],
    [
      'own notaries: the key decides what an answer proves',
      async () => {
        const settings = (endpoints) => ({ settings: { localMode: 'always', endpoints } });
        let v = await full.openPopup(siteUrl, settings([outside]));
        let r = await v.result();
        assert(r.verdict.code === 'confirmed' && r.notaries[0].signed === true, 'verified with its key', r.notaries[0]);
        await v.close();

        const otherKey = { ...outside, id: 'other-key', keys: [keys.plusPrivacy.publicKey] };
        v = await full.openPopup(siteUrl, settings([otherKey]));
        r = await v.result();
        let ui = await v.ui();
        assert(
          r.notaries[0].error?.code === 'unknownKey' && ui.witnesses[1].error === msg('notaryErr_unknownKey'),
          'an answer signed with another key is refused',
          { notary: r.notaries[0], witnesses: ui.witnesses },
        );
        await v.close();

        // Without a key, agreement proves nothing about a certificate that is not publicly
        // logged: an interceptor could have written the answer.
        const noKey = { ...outside, id: 'no-key', name: 'Notary without a key', keys: [] };
        v = await full.openPopup(siteUrl, { ...settings([noKey]), shot: 'unsigned-only' });
        r = await v.result();
        ui = await v.ui();
        await v.snap();
        assert(
          r.verdict.code === 'confirmedUnsigned' && ui.tone === 'warn' && ui.title === msg('verdictUnsignedTitle'),
          'only unsigned answers agree',
          { verdict: r.verdict.code, ui },
        );
        assert((await v.badge()) === '?', 'amber badge', await v.badge());
        await v.close();

        // Nor does an unsigned answer outweigh a signed one that sees another certificate.
        const insideNoKey = { ...inside, id: 'inside-no-key', keys: [] };
        v = await full.openPopup(interceptedUrl, settings([outside, insideNoKey]));
        r = await v.result();
        assert(r.verdict.code === 'intercepted' && r.verdict.level === 'danger', 'the signed answer decides', {
          verdict: r.verdict,
        });
        await v.close();
      },
    ],
    [
      'interception detected',
      async () => {
        const v = await full.openPopup(interceptedUrl, {
          settings: { localMode: 'always', endpoints: [outside] },
          shot: 'intercepted',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(r.verdict.code === 'intercepted' && ui.tone === 'danger', 'expected intercepted/danger', {
          verdict: r.verdict,
          ui,
        });
        assert(
          r.verdict.localIssuer === 'Contoso Inspection CA (Contoso Ltd)',
          'local issuer named',
          r.verdict.localIssuer,
        );
        assert(ui.witnesses[1].chip === msg('relationDifferent'), 'different chip', ui.witnesses);
        assert((await v.badge()) === '!', 'red badge on the icon', await v.badge());
        await v.close();
      },
    ],
    [
      'wrong notary token',
      async () => {
        const v = await full.openPopup(siteUrl, {
          settings: { localMode: 'always', endpoints: [endpoint('bad', 'Notary with wrong token', sitePort, 'nope')] },
          shot: 'bad-token',
        });
        const r = await v.result();
        const ui = await v.ui();
        assert(
          r.notaries[0].state === 'error' && r.notaries[0].error.code === 'unauthorized',
          'unauthorized',
          r.notaries[0],
        );
        assert(ui.witnesses[1].error === msg('notaryErr_unauthorized'), 'error text', ui.witnesses[1]);
        await v.close();
      },
    ],
    [
      'notaries disagree',
      async () => {
        const v = await full.openPopup(interceptedUrl, {
          settings: { localMode: 'always', endpoints: [outside, inside] },
          shot: 'split',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(r.verdict.code === 'split' && ui.tone === 'warn', 'expected split/warn', { verdict: r.verdict, ui });
        assert(
          ui.body.includes('Notary inside your network') && ui.body.includes('Notary outside'),
          'body names both sides',
          ui.body,
        );
        await v.close();
      },
    ],
    [
      'on-demand local reading',
      async () => {
        const v = await full.openPopup(siteUrl, { settings: { localMode: 'ask', endpoints: [outside] }, shot: 'ask' });
        let r = await v.result();
        let ui = await v.ui();
        await v.snap('-before');
        assert(r.verdict.code === 'externalOnly' && r.local.state === 'notRequested', 'external first', {
          verdict: r.verdict.code,
          local: r.local,
        });
        assert(ui.buttons.includes(msg('actionReadLocal')), 'read-local button', ui.buttons);
        await v.click(msg('actionReadLocal'));
        r = await v.result();
        ui = await v.ui();
        await v.snap('-after');
        assert(r.verdict.code === 'confirmed' && r.local.state === 'ok', 'confirmed after reading', {
          verdict: r.verdict.code,
          ui,
        });
        await v.close();
      },
    ],
    [
      'strict CSP page needs a reload',
      async () => {
        const v = await full.openPopup(`${siteUrl}csp`, {
          settings: { localMode: 'always', endpoints: [outside] },
          shot: 'csp',
        });
        let r = await v.result();
        let ui = await v.ui();
        await v.snap('-blocked');
        assert(r.local.state === 'error' && r.local.reason === 'probeBlocked', 'probe blocked', r.local);
        assert(ui.buttons.includes(msg('actionReloadAndRead')), 'reload button', ui.buttons);
        await v.click(msg('actionReloadAndRead'));
        r = await v.result();
        ui = await v.ui();
        await v.snap('-reloaded');
        assert(
          r.local.state === 'ok' && r.local.via === 'reload' && r.verdict.code === 'confirmed',
          'read after reload',
          { local: r.local.state, via: r.local.via, verdict: r.verdict.code },
        );
        assert(ui.witnesses[0].meta.includes(msg('witnessViaReload')), 'reload noted', ui.witnesses[0]);
        await v.close();
      },
    ],
    [
      'nothing configured',
      async () => {
        const v = await full.openPopup(siteUrl, {
          settings: { localMode: 'never', endpoints: [] },
          shot: 'no-sources',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(r.verdict.code === 'noSources' && ui.tone === 'neutral', 'noSources', { verdict: r.verdict.code, ui });
        assert(ui.buttons.includes(msg('actionAddSource')), 'add-source button', ui.buttons);
        await v.close();
      },
    ],
    [
      'notary unreachable',
      async () => {
        const down = {
          id: 'down',
          name: 'Offline notary',
          url: `http://127.0.0.1:${closedPort}/v1/cert`,
          token: '',
          enabled: true,
        };
        const v = await full.openPopup(siteUrl, {
          settings: { localMode: 'always', endpoints: [down] },
          shot: 'notary-down',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(
          r.notaries[0].state === 'error' && r.notaries[0].error.code === 'network',
          'network error',
          r.notaries[0],
        );
        assert(ui.witnesses[1].error === msg('notaryErr_network'), 'error text', ui.witnesses[1]);
        assert(r.verdict.code === 'privateCa', 'falls back to local verdict', r.verdict.code);
        await v.close();
      },
    ],
    [
      'internal host skips notaries',
      async () => {
        const v = await full.openPopup(`https://localhost:${sitePort}/`, {
          settings: { localMode: 'always', endpoints: [outside] },
          shot: 'internal',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(r.internal && r.notaries.every((n) => n.state === 'skipped'), 'skipped', r.notaries);
        assert(ui.notes.includes(msg('externalSkippedInternal')), 'note shown', ui.notes);
        await v.close();
      },
    ],
    [
      'plain HTTP page',
      async () => {
        const v = await full.openPopup(`http://${HOST}:${plainPort}/`, {
          settings: { localMode: 'always', endpoints: [outside] },
          shot: 'http',
        });
        const r = await v.result();
        const ui = await v.ui();
        await v.snap();
        assert(r.verdict.code === 'insecureHttp' && ui.tone === 'warn', 'insecureHttp', {
          verdict: r.verdict.code,
          ui,
        });
        assert(
          r.local.state === 'notApplicable' && r.notaries[0].state === 'ok',
          'notary still shows the 443 certificate',
          r.notaries[0].state,
        );
        await v.close();
      },
    ],
    [
      'non-web page',
      async () => {
        const v = await full.openPopup('chrome://settings/', {
          settings: { localMode: 'always', endpoints: [] },
          shot: 'unsupported',
        });
        const ui = await v.ui();
        assert(ui.title === msg('unsupportedTitle'), 'unsupported state', ui);
        await v.close();
      },
    ],
    [
      'options page: add, validate and test a source',
      async () => {
        await full.settings({});
        const page = await full.ctx.newPage();
        full.watch(page, 'options');
        await page.setViewportSize({ width: 900, height: 1200 });
        await page.goto(`chrome-extension://${full.extId}/options/options.html`);
        await page.fill('#ep-name', 'Bad');
        await page.fill('#ep-url', 'http://notary.example.net/v1/cert');
        await page.click('#endpoint-form button[type=submit]');
        assert((await page.textContent('#form-error')) === msg('endpointErrorHttps'), 'http rejected');
        await page.fill('#ep-name', 'Test notary');
        await page.fill('#ep-url', outside.url);
        await page.fill('#ep-token', TOKEN);
        await page.click('#endpoint-form button[type=submit]');
        await page.waitForFunction(() => document.querySelectorAll('.endpoint').length === 2);
        await page.check('input[name=localMode][value=ask]');
        const testOutcome = async (row, tone = '') => {
          await row.getByRole('button', { name: msg('actionTest') }).click();
          await row.locator(`.endpoint-result[data-tone${tone}]`).waitFor();
          return row.locator('.endpoint-result').textContent();
        };
        const outcome = await testOutcome(page.locator('.endpoint').last());
        assert(outcome.startsWith(msg('testOk', '').split(':')[0]), 'test reports success', outcome);
        assert(
          outcome.includes(msg('testSelfSigned', keys.own.publicKey)),
          'test shows the key it signs with',
          outcome,
        );

        // The same notary again (another port), this time with its key.
        await page.fill('#ep-name', 'Pinned notary');
        await page.fill('#ep-url', inside.url);
        await page.fill('#ep-token', TOKEN);
        await page.fill('#ep-key', 'ed25519:not-a-key');
        await page.click('#endpoint-form button[type=submit]');
        assert((await page.textContent('#form-error')) === msg('endpointErrorKey'), 'malformed key rejected');
        await page.fill('#ep-url', `http://127.0.0.1:${notary.port}/cert/{host}`);
        await page.fill('#ep-key', keys.own.publicKey);
        await page.click('#endpoint-form button[type=submit]');
        assert((await page.textContent('#form-error')) === msg('endpointErrorKeyUrl'), 'a key needs ?host= in the URL');
        await page.fill('#ep-url', inside.url);
        await page.click('#endpoint-form button[type=submit]');
        await page.waitForFunction(() => document.querySelectorAll('.endpoint').length === 3);
        const pinnedRow = page.locator('.endpoint').last();
        assert((await pinnedRow.textContent()).includes(msg('keySet')), 'key noted', await pinnedRow.textContent());
        const pinnedOutcome = await testOutcome(pinnedRow, '=ok');
        assert(pinnedOutcome.endsWith(msg('testSigned')), 'pinned notary verified', pinnedOutcome);

        const plusPrivacy = page.locator('.endpoint').first();
        assert((await plusPrivacy.textContent()).includes(msg('defaultSource')), 'PlusPrivacy listed first');
        assert(!(await page.isChecked('#default-notary')), 'PlusPrivacy off, as stored');
        await page.check('#default-notary');
        const plusOutcome = await testOutcome(plusPrivacy, '=ok');
        assert(plusOutcome.endsWith(msg('testSigned')), 'PlusPrivacy answer verified', plusOutcome);
        const stored = await full.sw.evaluate(() =>
          chrome.storage.local.get(['endpoints', 'localMode', 'defaultNotary']),
        );
        assert(
          stored.localMode === 'ask' &&
            stored.defaultNotary === true &&
            stored.endpoints.length === 2 &&
            stored.endpoints[0].name === 'Test notary' &&
            stored.endpoints[0].keys.length === 0 &&
            stored.endpoints[1].keys.join() === keys.own.publicKey,
          'saved',
          stored,
        );
        mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });
        await page.close();
      },
    ],
    [
      'site memory: first, known, changed, trusted, forgotten',
      async () => {
        const url = `https://${HOST}:${memoryPort}/`;
        const realCa = 'SSL Checker Test Issuing CA (SSL Checker Test PKI)';
        const otherCa = 'Contoso Inspection CA (Contoso Ltd)';
        serveOnMemorySite(read('site-leaf.key'), siteChain);

        let v = await full.openPopup(url, { settings: { localMode: 'always', endpoints: [] }, shot: 'memory-first' });
        let r = await v.result();
        let ui = await v.ui();
        await v.snap();
        assert(r.memory.status === 'first' && ui.history[0] === msg('historyFirst', realCa), 'first check remembered', {
          memory: r.memory,
          ui,
        });
        await v.close();

        v = await full.openPopup(url, { shot: 'memory-known' });
        r = await v.result();
        ui = await v.ui();
        assert(
          r.memory.status === 'known' && r.memory.entry.count === 2 && ui.history[0].includes(realCa),
          'second check known',
          { memory: r.memory, ui },
        );
        await v.close();

        serveOnMemorySite(read('intercept-leaf.key'), interceptChain);
        v = await full.openPopup(url, { shot: 'memory-changed' });
        r = await v.result();
        ui = await v.ui();
        await v.snap();
        // CT is "unknown" for both test chains, so this is a private-to-private change.
        assert(
          r.memory.status === 'changed' && r.memory.kind === 'privateToPrivate' && !r.memory.learned,
          'change detected',
          r.memory,
        );
        assert(
          r.verdict.warnings[0].code === 'caChanged' && ui.warnings.includes(msg('warnCaChanged', realCa, otherCa)),
          'change warned',
          ui.warnings,
        );
        assert(ui.history.includes(msg('historyChangedNow', otherCa)), 'history shows the new CA', ui.history);
        assert(
          ui.buttons.includes(msg('actionTrustCa')) && ui.buttons.includes(msg('actionForgetSite')),
          'trust and forget offered',
          ui.buttons,
        );

        await v.historyAction(msg('actionTrustCa'), msg('historyTrusted', otherCa));
        r = await v.result();
        ui = await v.ui();
        await v.snap('-trusted');
        assert(
          r.memory.status === 'known' && r.memory.trusted && !r.verdict.warnings.some((w) => w.code === 'caChanged'),
          'trusted',
          { memory: r.memory, warnings: r.verdict.warnings },
        );
        assert(
          !ui.warnings.includes(msg('warnCaChanged', realCa, otherCa)) &&
            !ui.buttons.includes(msg('actionTrustCa')) &&
            ui.buttons.includes(msg('actionForgetSite')),
          'popup after trusting: no warning, only "Forget this site"',
          { warnings: ui.warnings, buttons: ui.buttons },
        );

        await v.historyAction(msg('actionForgetSite'), msg('historyForgotten'));
        r = await v.result();
        const keys = await full.sw.evaluate(async () =>
          Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('site:')),
        );
        assert(r.memory.status === 'forgotten' && keys.length === 0, 'forgotten', { memory: r.memory, keys });
        await v.close();

        v = await full.openPopup(url, {});
        r = await v.result();
        assert(r.memory.status === 'first' && r.memory.current.label === otherCa, 'history starts again', r.memory);
        await v.close();

        const pluralKey = (base, n) => {
          const category = new Intl.PluralRules(LANG).select(n);
          return `${base}${category === 'one' ? 'One' : category === 'few' ? 'Few' : 'Other'}`;
        };
        const page = await full.ctx.newPage();
        full.watch(page, 'options (memory)');
        await page.goto(`chrome-extension://${full.extId}/options/options.html`);
        await page.waitForFunction(() => document.getElementById('memory-count').textContent !== '');
        assert(
          (await page.textContent('#memory-count')) === msg(pluralKey('memoryCount', 1), '1'),
          'one site counted',
          await page.textContent('#memory-count'),
        );
        await page.click('#forget-all');
        await page.waitForFunction(
          (text) => document.getElementById('memory-count').textContent === text,
          msg(pluralKey('memoryCount', 0), '0'),
        );
        await page.uncheck('#memory-enabled');
        await page.waitForFunction(
          async () => (await chrome.storage.local.get('memoryEnabled')).memoryEnabled === false,
        );
        await page.close();

        v = await full.openPopup(url, {});
        r = await v.result();
        ui = await v.ui();
        assert(r.memory.status === 'disabled' && ui.history.length === 0, 'memory off', { memory: r.memory, ui });
        await v.close();
      },
    ],
  ];

  const results = [];
  for (const [name, fn] of scenarios) {
    if (ONLY && !name.includes(ONLY)) {
      continue;
    }
    try {
      await fn();
      results.push([name, null]);
    } catch (error) {
      results.push([name, error]);
    }
  }
  await full.stop();

  const incognitoScenario = 'incognito: site memory is off';
  if (!ONLY || incognitoScenario.includes(ONLY)) {
    const inc = await new Harness(stageVariant('full', mkdtempSync(path.join(os.tmpdir(), 'sslc-inc-'))), args, {
      incognito: true,
    }).start();
    try {
      await inc.settings({ localMode: 'always', endpoints: [] });
      const tabId = await inc.openIncognitoTab(siteUrl);
      const popup = await inc.ctx.newPage();
      inc.watch(popup, 'popup (incognito tab)');
      await popup.setViewportSize({ width: 400, height: 600 });
      await popup.goto(
        `chrome-extension://${inc.extId}/popup/popup.html?tabId=${tabId}&url=${encodeURIComponent(siteUrl)}`,
      );
      const v = new PopupView(inc, popup, null, tabId, 'incognito');
      await v.settle();
      const r = await v.result();
      const ui = await v.ui();
      await v.snap();
      assert(r.incognito === true && r.local.state === 'ok', 'the incognito tab is still read from the browser', {
        incognito: r.incognito,
        local: r.local.state,
      });
      assert(r.memory.status === 'incognito' && ui.history[0] === msg('historyIncognito'), 'site memory off', {
        memory: r.memory,
        history: ui.history,
      });
      const keys = await inc.sw.evaluate(async () =>
        Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('site:')),
      );
      assert(keys.length === 0, 'nothing recorded from the incognito tab', keys);
      await v.close();
      // Closing the incognito tab also drops its result from session storage.
      const leftover = await inc.sw.evaluate(async (id) => {
        await chrome.tabs.remove(id);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return (await chrome.storage.session.get(`result:${id}`))[`result:${id}`] || null;
      }, tabId);
      assert(leftover === null, 'no result left after the incognito tab closed', leftover && leftover.host);

      const normal = await inc.openPopup(siteUrl, {});
      const r2 = await normal.result();
      assert(r2.incognito === false && r2.memory.status === 'first', 'a normal tab still uses the memory', r2.memory);
      await normal.close();
      results.push([incognitoScenario, null]);
    } catch (error) {
      results.push([incognitoScenario, error]);
    }
    full.errors.push(...inc.errors);
    await inc.stop();
  }

  if (!ONLY || 'lite build'.includes(ONLY)) {
    const lite = await new Harness(stageVariant('lite', mkdtempSync(path.join(os.tmpdir(), 'sslc-lite-'))), [
      ...args,
      '--disable-features=',
    ]).start();
    try {
      const v = await lite.openPopup(siteUrl, {
        settings: { localMode: 'always', endpoints: [outside] },
        shot: 'lite',
      });
      const r = await v.result();
      const ui = await v.ui();
      await v.snap();
      assert(!r.localAvailable && r.local.state === 'unavailable', 'no local reading in lite', r.local);
      assert(r.verdict.code === 'externalOnly' && ui.witnesses.length === 1, 'external only', {
        verdict: r.verdict.code,
        ui,
      });
      await v.close();
      const page = await lite.ctx.newPage();
      await page.goto(`chrome-extension://${lite.extId}/options/options.html`);
      assert(await page.isVisible('#local-unavailable'), 'lite notice visible');
      assert(await page.isDisabled('input[name=localMode][value=always]'), 'modes disabled');
      assert(await page.isHidden('#memory-panel'), 'site memory hidden: it needs local reading');
      results.push(['lite build', null]);
    } catch (error) {
      results.push(['lite build', error]);
    }
    full.errors.push(...lite.errors);
    await lite.stop();
  }

  notary.child.kill();
  publicNotary.child.kill();
  tamper.close();
  rmSync(keyDir, { recursive: true, force: true });
  site.close();
  intercept.close();
  plain.close();
  memorySite.close();
  for (const server of elsewhere) {
    server.close();
  }

  let failed = 0;
  for (const [name, error] of results) {
    console.log(
      `${error ? 'FAIL' : 'ok  '} ${name}${error ? `\n     ${error.message.replace(/\n/g, '\n     ')}` : ''}`,
    );
    if (error) {
      failed++;
    }
  }
  if (full.errors.length) {
    console.log(`\nConsole errors:\n  ${full.errors.join('\n  ')}`);
    failed++;
  }
  console.log(
    `\n${results.length - failed}/${results.length} passed (${LANG}), screenshots in ${path.relative(ROOT, OUT)}`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
