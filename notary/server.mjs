#!/usr/bin/env node
// SSL Checker notary — reference implementation of the notary protocol v1.
//
// Connects to the requested host from this server's vantage point and reports
// the certificate chain it receives. No dependencies; Node.js 20 or newer.
//
//   GET /v1/cert?host=example.com&port=443   → certificate chain as seen from here
//   GET /v1/health                           → liveness and configuration summary
//
// Environment:
//   PORT            port to listen on (default 8080)
//   HOST            interface to bind (default 0.0.0.0)
//   NOTARY_NAME     label shown in the extension, e.g. "Frankfurt (Hetzner)" (default: hostname)
//   NOTARY_TOKEN    if set, requests must send "Authorization: Bearer <token>"
//   ALLOWED_PORTS   comma-separated target ports (default "443,8443")
//   CORS_ORIGIN     Access-Control-Allow-Origin value (default "*"; e.g. chrome-extension://<id>)
//   RATE_LIMIT      requests per minute per client IP (default 30)
//   MAX_CONCURRENT  simultaneous TLS probes (default 20)
//   CACHE_SECONDS   reuse an answer for the same host:port (default 60, 0 disables)
//   TRUST_PROXY=1   take the client IP from X-Forwarded-For (only behind your own reverse proxy)
//   UPSTREAM_PROXY  http://host:port — reach targets through an HTTP CONNECT proxy
//   ALLOW_PRIVATE=1 allow private/reserved target addresses (testing only — enables SSRF)
//   LOG_HOSTS=1     include target host names in the access log (off by default, for privacy)

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  name: (process.env.NOTARY_NAME || os.hostname()).slice(0, 80),
  token: process.env.NOTARY_TOKEN || '',
  allowedPorts: new Set(
    (process.env.ALLOWED_PORTS || '443,8443')
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0 && p < 65536),
  ),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  ratePerMinute: Number(process.env.RATE_LIMIT || 30),
  maxConcurrent: Number(process.env.MAX_CONCURRENT || 20),
  cacheMs: Number(process.env.CACHE_SECONDS ?? 60) * 1000,
  trustProxy: process.env.TRUST_PROXY === '1',
  upstreamProxy: process.env.UPSTREAM_PROXY ? new URL(process.env.UPSTREAM_PROXY) : null,
  allowPrivate: process.env.ALLOW_PRIVATE === '1',
  logHosts: process.env.LOG_HOSTS === '1',
  timeoutMs: 8000,
};

// ---------------------------------------------------------------------------
// Target validation (SSRF protection)
// ---------------------------------------------------------------------------

// Two separate lists: Node's BlockList compares IPv4 addresses with IPv6 rules
// as IPv4-mapped addresses, so a ::ffff:0:0/96 rule in a shared list would
// block every IPv4 address.
const blockedV4 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedV4.addSubnet(address, prefix, 'ipv4');
const blockedV6 = new net.BlockList();
for (const [address, prefix] of [
  // IPv4-mapped (::ffff:0:0/96), NAT64 and 6to4 embed IPv4 addresses: refused outright.
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blockedV6.addSubnet(address, prefix, 'ipv6');

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blockedV4.check(address, 'ipv4');
  if (family === 6) return blockedV6.check(address, 'ipv6');
  return true;
}

class NotaryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeHost(raw) {
  const value = String(raw || '').trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!value || value.length > 253) throw new NotaryError(400, 'badRequest', 'host is missing or too long');
  if (net.isIP(value)) return value;
  // Accept IDNs by converting them to their ASCII (punycode) form.
  let ascii;
  try {
    ascii = new URL(`https://${value}/`).hostname;
  } catch {
    throw new NotaryError(400, 'badRequest', 'host is not a valid name');
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(ascii)) throw new NotaryError(400, 'badRequest', 'host is not a valid name');
  // Names are only validated for syntax; the resolved address decides whether
  // the target is public (resolveTarget), which also covers single-label names.
  return ascii;
}

async function resolveTarget(host) {
  if (net.isIP(host)) {
    if (!config.allowPrivate && isBlockedAddress(host)) throw new NotaryError(403, 'forbiddenTarget', 'address is private or reserved');
    return host;
  }
  let records;
  try {
    records = await withTimeout(dns.lookup(host, { all: true, verbatim: true }), 4000, 'dns');
  } catch (error) {
    if (error instanceof NotaryError) throw error;
    throw new NotaryError(502, 'dnsFailed', `could not resolve ${host}`);
  }
  const usable = records.map((r) => r.address).filter((a) => config.allowPrivate || !isBlockedAddress(a));
  if (usable.length === 0) throw new NotaryError(403, 'forbiddenTarget', 'name resolves only to private or reserved addresses');
  return usable[0];
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new NotaryError(504, 'timeout', `${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// TLS probe
// ---------------------------------------------------------------------------

function connectThroughProxy(host, port, deadline) {
  return new Promise((resolve, reject) => {
    const proxy = config.upstreamProxy;
    const request = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${host.includes(':') ? `[${host}]` : host}:${port}`,
      headers: { Host: `${host}:${port}` },
      timeout: Math.max(1, deadline - Date.now()),
    });
    request.once('connect', (response, socket) => {
      if (response.statusCode === 200) resolve(socket);
      else {
        socket.destroy();
        reject(new NotaryError(502, 'connectFailed', `upstream proxy answered ${response.statusCode}`));
      }
    });
    request.once('timeout', () => request.destroy(new NotaryError(504, 'timeout', 'upstream proxy timed out')));
    request.once('error', (error) => reject(error instanceof NotaryError ? error : new NotaryError(502, 'connectFailed', 'upstream proxy unreachable')));
    request.end();
  });
}

function peerChain(socket) {
  const chain = [];
  const seen = new Set();
  let cert = socket.getPeerCertificate(true);
  while (cert && cert.raw && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    chain.push(cert.raw.toString('base64'));
    if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
    cert = cert.issuerCertificate;
  }
  return chain;
}

async function probe(host, port) {
  const deadline = Date.now() + config.timeoutMs;
  const address = config.upstreamProxy ? null : await resolveTarget(host);
  if (config.upstreamProxy) await resolveTarget(host); // still refuse private targets
  const rawSocket = config.upstreamProxy ? await connectThroughProxy(host, port, deadline) : null;

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      socket: rawSocket || undefined,
      host: rawSocket ? undefined : address,
      port: rawSocket ? undefined : port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false, // we report trust instead of refusing to look
      ALPNProtocols: ['h2', 'http/1.1'],
      minVersion: 'TLSv1',
      ciphers: 'DEFAULT:@SECLEVEL=0',
    });
    const timer = setTimeout(() => socket.destroy(new NotaryError(504, 'timeout', 'TLS handshake timed out')), Math.max(1, deadline - Date.now()));
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cipher = socket.getCipher() || {};
      const ephemeral = socket.getEphemeralKeyInfo() || {};
      const result = {
        version: 1,
        host,
        port,
        observedAt: new Date().toISOString(),
        vantage: config.name,
        // Through an upstream proxy the target's IP is known only to the proxy.
        address: rawSocket ? null : socket.remoteAddress || address,
        trusted: socket.authorized === true,
        trustError: socket.authorized ? null : String(socket.authorizationError || 'unknown'),
        tls: { protocol: socket.getProtocol() || null, cipher: cipher.standardName || cipher.name || null, group: ephemeral.name || null },
        chain: peerChain(socket),
      };
      socket.end();
      if (result.chain.length === 0) reject(new NotaryError(502, 'tlsFailed', 'server sent no certificate'));
      else resolve(result);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      if (error instanceof NotaryError) return reject(error);
      const code = /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE/.test(error.code || '') ? 'connectFailed' : 'tlsFailed';
      reject(new NotaryError(502, code, error.code || error.message));
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP plumbing: auth, rate limit, cache, concurrency
// ---------------------------------------------------------------------------

const buckets = new Map();
function allowRequest(ip) {
  if (!config.ratePerMinute) return true;
  const now = Date.now();
  const bucket = buckets.get(ip) || { tokens: config.ratePerMinute, at: now };
  bucket.tokens = Math.min(config.ratePerMinute, bucket.tokens + ((now - bucket.at) / 60000) * config.ratePerMinute);
  bucket.at = now;
  const ok = bucket.tokens >= 1;
  if (ok) bucket.tokens -= 1;
  buckets.set(ip, bucket);
  return ok;
}
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60000).unref();

const cache = new Map();
const pending = new Map();
let active = 0;

async function lookup(host, port) {
  const key = `${host}:${port}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  if (active >= config.maxConcurrent) throw new NotaryError(503, 'busy', 'too many checks in progress');
  active++;
  const task = probe(host, port)
    .then((value) => {
      if (config.cacheMs > 0) {
        cache.set(key, { value, expires: Date.now() + config.cacheMs });
        if (cache.size > 2000) cache.delete(cache.keys().next().value);
      }
      return value;
    })
    .finally(() => {
      active--;
      pending.delete(key);
    });
  pending.set(key, task);
  return task;
}

const tokenDigest = config.token ? crypto.createHash('sha256').update(config.token).digest() : null;
function authorized(req) {
  if (!tokenDigest) return true;
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return false;
  const given = crypto.createHash('sha256').update(match[1].trim()).digest();
  return crypto.timingSafeEqual(given, tokenDigest);
}

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function send(res, status, body) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Headers': 'Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    ...(config.corsOrigin !== '*' ? { Vary: 'Origin' } : {}),
    ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  });
  res.end(body === null ? undefined : JSON.stringify(body));
}

function sendError(res, error) {
  const status = error instanceof NotaryError ? error.status : 500;
  const code = error instanceof NotaryError ? error.code : 'internal';
  send(res, status, { version: 1, error: { code, message: error instanceof NotaryError ? error.message : 'internal error' } });
}

async function handle(req, res) {
  const started = Date.now();
  const url = new URL(req.url, 'http://notary.invalid');
  let logHost = '-';
  try {
    if (req.method === 'OPTIONS') {
      send(res, 204, null);
      return;
    }
    if (req.method !== 'GET') throw new NotaryError(405, 'badRequest', 'only GET is supported');
    if (url.pathname === '/v1/health') {
      send(res, 200, { version: 1, ok: true, vantage: config.name, ports: [...config.allowedPorts], auth: Boolean(tokenDigest) });
      return;
    }
    if (url.pathname !== '/v1/cert') throw new NotaryError(404, 'badRequest', 'unknown path; use /v1/cert or /v1/health');
    if (!authorized(req)) throw new NotaryError(401, 'unauthorized', 'missing or wrong bearer token');
    if (!allowRequest(clientIp(req))) throw new NotaryError(429, 'rateLimited', 'too many requests');

    const host = normalizeHost(url.searchParams.get('host'));
    const port = Number(url.searchParams.get('port') || 443);
    logHost = config.logHosts ? `${host}:${port}` : '*';
    if (!Number.isInteger(port) || !config.allowedPorts.has(port)) throw new NotaryError(403, 'forbiddenPort', `port ${port} is not allowed here`);
    send(res, 200, await lookup(host, port));
  } catch (error) {
    sendError(res, error);
  } finally {
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${logHost} ${res.statusCode} ${Date.now() - started}ms`);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => sendError(res, error));
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(config.port, config.host, () => {
  console.log(`SSL Checker notary "${config.name}" listening on ${config.host}:${config.port}` +
    ` (ports ${[...config.allowedPorts].join(',')}, auth ${tokenDigest ? 'on' : 'off'}${config.allowPrivate ? ', PRIVATE TARGETS ALLOWED' : ''})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
