// Shared test helpers: a notary on a free port, a local TLS site to look at, and
// small HTTP shortcuts. No test touches the internet.
import { readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createBans } from '../src/middleware/bans.js';
import { createCertService } from '../src/probe/service.js';
import { probeTls } from '../src/probe/tls.js';

export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

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

/** A TLS server on 127.0.0.1 with the self-signed "localhost" test certificate. */
export async function startTlsSite() {
  const server = createTlsServer({ key: fixture('localhost.key'), cert: fixture('localhost.crt') }, (socket) =>
    socket.end(),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
