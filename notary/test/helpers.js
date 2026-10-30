// Shared test helpers: a notary on a free port, a local TLS site to look at, and
// small HTTP shortcuts. No test touches the internet.
import { generateKeyPairSync, verify } from 'node:crypto';
import dns from 'node:dns/promises';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createBans } from '../src/middleware/bans.js';
import { createCertService } from '../src/probe/service.js';
import { probeTls } from '../src/probe/tls.js';
import { SIGNATURE_CONTEXT } from '../src/signing.js';

export const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
export const fixture = (name) => readFileSync(fixturePath(name));

/** A new Ed25519 key in a temporary PEM file, as SIGNING_KEY_FILE expects it. */
export function signingKeyFile() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const dir = mkdtempSync(join(tmpdir(), 'notary-key-'));
  const file = join(dir, 'signing-key.pem');
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return {
    file,
    publicKey,
    text: `ed25519:${publicKey.export({ format: 'jwk' }).x}`,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** What a client checks: the Notary-Signature header signs exactly these bytes. */
export function signatureHolds(publicKey, body, signature) {
  const message = Buffer.concat([Buffer.from(SIGNATURE_CONTEXT), body]);
  return verify(null, message, publicKey, Buffer.from(signature, 'base64url'));
}

export const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

/** A logger that keeps its lines in memory, for assertions. */
export function memoryLogger() {
  const lines = [];
  const log = (level, msg, fields = {}) => lines.push({ level, msg, ...fields });
  return {
    lines,
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
  };
}

/** Starts a notary with the given environment; `probe` replaces the real TLS probe. */
export async function startNotary(env = {}, { probe } = {}) {
  const config = loadConfig({ NOTARY_NAME: 'Test vantage', ...env });
  const logger = memoryLogger();
  const bans = createBans({ ...config.bans, logger });
  const service = createCertService({
    probe: probe ?? ((host, port) => probeTls(host, port, config)),
    cacheMs: config.cacheMs,
    maxConcurrent: config.maxConcurrent,
    globalPerMinute: config.globalPerMinute,
  });
  const app = createApp({ config, logger, bans, service });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    logs: logger.lines,
    bans,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/**
 * A TLS server with the self-signed "localhost" test certificate. It listens on the
 * first address "localhost" resolves to, which is the one the notary connects to:
 * ::1 on GitHub's runners and on Windows, 127.0.0.1 where only that one is listed.
 */
export async function startTlsSite() {
  const [{ address }] = await dns.lookup('localhost', { all: true, verbatim: true });
  const server = createTlsServer({ key: fixture('localhost.key'), cert: fixture('localhost.crt') }, (socket) =>
    socket.end(),
  );
  await new Promise((resolve) => server.listen(0, address, resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** A port on which nothing listens. */
export function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export async function get(base, path, headers = {}, method = 'GET') {
  const res = await fetch(base + path, { method, headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
