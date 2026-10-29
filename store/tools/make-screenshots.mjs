#!/usr/bin/env node
// Renders the Chrome Web Store images from the real extension UI.
// The popup shows results built by the extension's own parser and verdict code
// from the fictional certificates in store/tools/certs (no real site involved).
//   node store/tools/make-screenshots.mjs        (needs Playwright + Chromium, see tests/e2e/run.mjs)
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageVariant } from '../../scripts/build.mjs';
import { describeChain } from '../../extension/lib/x509.js';
import { computeVerdict } from '../../extension/lib/verdict.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = path.join(ROOT, 'store/screenshots');
const HOST = 'www.example.com';

const pemChain = (file) =>
  [
    ...readFileSync(path.join(ROOT, 'store/tools/certs', file), 'utf8').matchAll(
      /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END/g,
    ),
  ].map((m) => m[1].replace(/\s+/g, ''));

const COPY = {
  en: {
    confirmed: [
      'See the certificate your browser really received',
      'Chain, TLS version, key exchange and Certificate Transparency, read straight from Chrome and confirmed by independent notaries.',
    ],
    intercepted: [
      'Catch HTTPS interception',
      'Notaries show what the rest of the internet sees. A different, unlogged certificate means something on your path is re-signing your traffic.',
    ],
    details: [
      'Every detail, one click away',
      'Names, validity, chain, fingerprints, key pin, OCSP and CRL, SCTs and extensions. Copy the PEM or download the chain.',
    ],
    options: [
      'You decide when the debugger runs',
      'Read the certificate every time, on demand or never, and choose whether SSL Checker remembers the sites you check.',
    ],
    tagline: 'See the real certificate. Catch interception.',
  },
  ro: {
    confirmed: [
      'Vezi certificatul primit cu adevărat de browser',
      'Lanțul, versiunea TLS, schimbul de chei și Certificate Transparency, citite direct din Chrome și confirmate de notari independenți.',
    ],
    intercepted: [
      'Prinde interceptarea HTTPS',
      'Notarii arată ce vede restul internetului. Un certificat diferit și neînregistrat public înseamnă că cineva de pe drum îți re-semnează traficul.',
    ],
    details: [
      'Toate detaliile, la un clic',
      'Nume, valabilitate, lanț, amprente, pin de cheie, OCSP și CRL, SCT-uri și extensii. Copiezi PEM-ul sau descarci lanțul.',
    ],
    options: [
      'Tu decizi când rulează <span class="nowrap">debugger-ul</span>',
      'Citește certificatul de fiecare dată, la cerere sau niciodată și alege dacă SSL Checker ține minte site-urile verificate.',
    ],
    tagline: 'Vezi certificatul real. Prinde interceptarea.',
  },
};

async function buildResults() {
  const genuine = await describeChain(pemChain('genuine-chain.pem'));
  const intercepted = await describeChain(pemChain('intercepted-chain.pem'));
  const target = { secure: true, host: HOST, port: 443, origin: `https://${HOST}` };
  const notary = (id, name, origin, vantage, ms) => ({
    id,
    name,
    origin,
    durationMs: ms,
    state: 'ok',
    vantage,
    address: '93.184.215.14',
    observedAt: new Date().toISOString(),
    trusted: true,
    trustError: null,
    tls: { protocol: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256', group: 'X25519MLKEM768' },
    chain: genuine,
  });
  // The built-in PlusPrivacy notary, plus one the user added.
  const notaries = [
    notary('plusprivacy', 'PlusPrivacy', 'https://notary.plusprivacy.com', 'PlusPrivacy', 48),
    notary('iad', 'Virginia', 'https://notary-iad.example.net', 'Ashburn, US', 112),
  ];
  const sct = (log, minute) => ({
    status: 'Verified',
    origin: 'Embedded in certificate',
    logDescription: `Example CT log '${log}'`,
    logId: '',
    timestamp: genuine[0].notBefore.replace(/:\d\d\.\d+Z$/, `:0${minute}.000Z`),
  });
  const genuineLocal = {
    state: 'ok',
    via: 'probe',
    chain: genuine,
    remoteAddress: { ip: '93.184.215.14', port: 443 },
    httpProtocol: 'h2',
    security: {
      protocol: 'TLS 1.3',
      keyExchange: '',
      keyExchangeGroup: 'X25519MLKEM768',
      cipher: 'AES_128_GCM',
      mac: null,
      serverSignatureAlgorithm: 0x0403,
      encryptedClientHello: true,
      certificateTransparencyCompliance: 'compliant',
      signedCertificateTimestamps: [sct('Aster 2026h2', 1), sct('Birch 2026h2', 2), sct('Cedar 2026h2', 3)],
    },
  };
  const interceptedLocal = {
    state: 'ok',
    via: 'probe',
    chain: intercepted,
    remoteAddress: { ip: '93.184.215.14', port: 443 },
    httpProtocol: 'h2',
    security: {
      protocol: 'TLS 1.3',
      keyExchange: '',
      keyExchangeGroup: 'X25519',
      cipher: 'AES_256_GCM',
      mac: null,
      serverSignatureAlgorithm: 0x0804,
      encryptedClientHello: false,
      certificateTransparencyCompliance: 'unknown',
      signedCertificateTimestamps: [],
    },
  };
  const result = (local) => ({
    v: 1,
    origin: target.origin,
    host: HOST,
    port: 443,
    secure: true,
    internal: false,
    checkedAt: new Date().toISOString(),
    localMode: 'always',
    localAvailable: true,
    endpointsConfigured: notaries.length,
    local,
    notaries,
    verdict: computeVerdict({ target, local, notaries }),
  });
  return { confirmed: result(genuineLocal), intercepted: result(interceptedLocal) };
}

async function popupShot(ctx, sw, extId, result, tabId, { expand = false } = {}) {
  await sw.evaluate(
    async ([key, value]) => chrome.storage.session.set({ [key]: value }),
    [`result:${tabId}`, { ...result, tabId, checkedAt: new Date().toISOString() }],
  );
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 400, height: 600 });
  await page.goto(
    `chrome-extension://${extId}/popup/popup.html?tabId=${tabId}&url=${encodeURIComponent(`https://${HOST}/`)}`,
  );
  await page.waitForSelector('#content:not(.loading) .verdict');
  if (expand) {
    for (const summary of await page.$$('details > summary')) {
      await summary.click();
    }
    await page.evaluate(() => document.querySelector('details:last-of-type').scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -380));
  }
  await page.waitForTimeout(300);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 600 } });
  await page.close();
  return png;
}

async function optionsShot(ctx, sw, extId) {
  await sw.evaluate(() => {
    // A few remembered sites, so the site memory section shows a real count.
    const sites = {};
    for (let i = 1; i <= 37; i++) {
      const host = `site${i}.example.com`;
      sites[`site:${host}#443`] = { v: 1, host, port: 443, cas: [] };
    }
    return chrome.storage.local.set({
      consent: { version: 1, at: new Date().toISOString() },
      localMode: 'always',
      memoryEnabled: true,
      defaultNotary: true,
      endpoints: [
        { id: 'iad', name: 'Virginia', url: 'https://notary-iad.example.net/v1/cert', token: 'x', enabled: true },
      ],
      ...sites,
    });
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(`chrome-extension://${extId}/options/options.html`);
  await page.waitForSelector('.endpoint');
  await page.waitForFunction(() => document.getElementById('memory-count').textContent !== '');
  await page.evaluate(() => document.querySelector('.page').style.setProperty('padding-top', '28px'));
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 900 } });
  await page.close();
  return png;
}

const dataUri = (buf, type) => `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
const font = (file) => dataUri(readFileSync(path.join(ROOT, 'extension/fonts', file)), 'font/woff2');
const FONTS = `
@font-face { font-family: 'Atkinson Next'; font-weight: 200 800; src: url(${font('atkinson-hyperlegible-next-latin-wght-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Atkinson Next'; font-weight: 200 800; unicode-range: U+0100-024F, U+1E00-1EFF; src: url(${font('atkinson-hyperlegible-next-latin-ext-wght-normal.woff2')}) format('woff2'); }`;

function composeHtml({ title, body, shot, shotWidth, shotHeight, icon }) {
  return `<!doctype html><meta charset="utf-8"><style>${FONTS}
  * { box-sizing: border-box; } html, body { margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; background: #f5f7fa; color: #16233a; font-family: 'Atkinson Next', sans-serif;
         display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 64px; padding: 0 88px 0 96px; position: relative; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 20px; font-weight: 700; margin-bottom: 36px; }
  h1 { font-size: 46px; line-height: 1.12; font-weight: 720; margin: 0 0 22px; letter-spacing: -0.01em; max-width: 13ch; }
  p { font-size: 20px; line-height: 1.5; color: #485870; margin: 0; max-width: 30ch; }
  .nowrap { white-space: nowrap; }
  .frame { width: ${shotWidth}px; height: ${shotHeight}px; border-radius: 12px; overflow: hidden; background: #fff;
           border: 1px solid #c3ccd9; box-shadow: 18px 18px 0 #dde6f3; }
  .frame img { display: block; width: 100%; height: 100%; }
  </style>
  <div><div class="brand"><img src="${icon}" width="40" height="40" alt="">SSL Checker</div><h1>${title}</h1><p>${body}</p></div>
  <div class="frame"><img src="${shot}" alt=""></div>`;
}

function promoHtml(tagline, icon) {
  const bars = Array.from({ length: 41 }, (_, i) => {
    const h = 6 + ((i * 37) % 23);
    return `<rect x="${i * 9}" y="${30 - h}" width="5" height="${h}" rx="1"/>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><style>${FONTS}
  html, body { margin: 0; } body { width: 440px; height: 280px; overflow: hidden; background: #16233a; color: #fff; font-family: 'Atkinson Next', sans-serif; position: relative; }
  .row { position: absolute; left: 36px; top: 46px; display: flex; align-items: center; gap: 16px; }
  .tile { width: 72px; height: 72px; border-radius: 16px; background: #f5f7fa; display: grid; place-items: center; }
  .name { font-size: 34px; font-weight: 720; }
  p { position: absolute; left: 36px; top: 140px; margin: 0; font-size: 17px; line-height: 1.4; color: #c9d6ea; max-width: 330px; }
  svg { position: absolute; left: 36px; bottom: 32px; fill: #74a3ee; }
  </style><div class="row"><span class="tile"><img src="${icon}" width="56" height="56" alt=""></span><span class="name">SSL Checker</span></div><p>${tagline}</p>
  <svg width="365" height="30" viewBox="0 0 365 30">${bars}</svg>`;
}

async function render(browserPage, html, file, width, height) {
  await browserPage.setViewportSize({ width, height });
  await browserPage.setContent(html, { waitUntil: 'load' });
  await browserPage.evaluate(() => document.fonts.ready);
  await browserPage.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
}

async function main() {
  const results = await buildResults();
  const ext = stageVariant('full', mkdtempSync(path.join(os.tmpdir(), 'sslc-store-')));
  const icon = dataUri(readFileSync(path.join(ROOT, 'extension/icons/ssl128.png')), 'image/png');
  for (const lang of ['en', 'ro']) {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'sslc-store-profile-'));
    const ctx = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROME_PATH || undefined,
      headless: true,
      deviceScaleFactor: 2,
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        '--headless=new',
        `--lang=${lang}`,
        '--no-proxy-server',
      ],
    });
    let [sw] = ctx.serviceWorkers();
    if (!sw) {
      sw = await ctx.waitForEvent('serviceworker');
    }
    const extId = new URL(sw.url()).host;
    const shots = {
      confirmed: await popupShot(ctx, sw, extId, results.confirmed, 101),
      intercepted: await popupShot(ctx, sw, extId, results.intercepted, 102),
      details: await popupShot(ctx, sw, extId, results.confirmed, 103, { expand: true }),
      options: await optionsShot(ctx, sw, extId),
    };
    const dir = path.join(OUT, lang);
    mkdirSync(dir, { recursive: true });
    // Store images must be exactly 1280x800 and 440x280: compose them at device scale 1.
    const plain = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
    const composer = await plain.newPage({ deviceScaleFactor: 1 });
    const order = ['confirmed', 'intercepted', 'details', 'options'];
    for (const [i, key] of order.entries()) {
      const [title, body] = COPY[lang][key];
      const isOptions = key === 'options';
      await render(
        composer,
        composeHtml({
          title,
          body,
          shot: dataUri(shots[key], 'image/png'),
          shotWidth: isOptions ? 520 : 440,
          shotHeight: isOptions ? 731 : 660,
          icon,
        }),
        path.join(dir, `${i + 1}-${key}.png`),
        1280,
        800,
      );
    }
    await render(composer, promoHtml(COPY[lang].tagline, icon), path.join(dir, 'promo-440x280.png'), 440, 280);
    await plain.close();
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
    console.log(`${lang}: ${order.length} screenshots + promo tile in ${path.relative(ROOT, dir)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
