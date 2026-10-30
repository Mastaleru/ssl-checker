// Reads the settings from environment variables (see README.md and .env.example).
// A bad value stops the notary at startup, with every problem listed at once,
// instead of surfacing later as odd behavior.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { createSigner } from './signing.js';

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const EXTENSION_ORIGIN = /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f-]{36})$/;

export function loadConfig(env = process.env) {
  const problems = [];
  const read = (name) => String(env[name] ?? '').trim();

  const int = (name, fallback, min, max) => {
    const raw = read(name);
    if (raw === '') {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
      return fallback;
    }
    return value;
  };

  const flag = (name) => {
    const raw = read(name).toLowerCase();
    if (['', '0', 'false', 'no'].includes(raw)) {
      return false;
    }
    if (['1', 'true', 'yes'].includes(raw)) {
      return true;
    }
    problems.push(`${name} must be 1 or 0 (got "${read(name)}")`);
    return false;
  };

  const list = (name, fallback = '') =>
    (read(name) || fallback)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const allowedPorts = new Set();
  for (const item of list('ALLOWED_PORTS', '443,8443')) {
    const port = Number(item);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      allowedPorts.add(port);
    } else {
      problems.push(`ALLOWED_PORTS has an invalid port "${item}"`);
    }
  }
  if (allowedPorts.size === 0) {
    problems.push('ALLOWED_PORTS must list at least one port');
  }

  // CORS_ORIGIN is the older, single-origin form of ALLOWED_ORIGINS.
  const legacyOrigin = read('CORS_ORIGIN');
  const originSource = read('ALLOWED_ORIGINS') ? 'ALLOWED_ORIGINS' : 'CORS_ORIGIN';
  const allowedOrigins = [];
  for (const origin of originSource === 'ALLOWED_ORIGINS' ? list('ALLOWED_ORIGINS') : list('CORS_ORIGIN')) {
    if (origin === '*') {
      continue;
    }
    if (EXTENSION_ORIGIN.test(origin) || isWebOrigin(origin)) {
      allowedOrigins.push(origin);
    } else {
      problems.push(
        `${originSource} has an invalid origin "${origin}" (expected e.g. chrome-extension://<32-letter ID>)`,
      );
    }
  }
  if (legacyOrigin && read('ALLOWED_ORIGINS')) {
    problems.push('Set ALLOWED_ORIGINS or the older CORS_ORIGIN, not both');
  }

  // Express's "trust proxy" setting: the number of proxies in front of the notary
  // ("1" behind Caddy), or the addresses of trusted proxies ("loopback, uniquelocal").
  // "true" would trust whatever X-Forwarded-For a client writes, so it is refused.
  const trustRaw = read('TRUST_PROXY');
  let trustProxy = false;
  if (/^\d+$/.test(trustRaw)) {
    trustProxy = Number(trustRaw);
  } else if (trustRaw.toLowerCase() === 'true') {
    problems.push('TRUST_PROXY=true would let clients forge their address; use the number of proxies, e.g. 1');
  } else if (trustRaw && trustRaw.toLowerCase() !== 'false') {
    trustProxy = trustRaw;
  }

  const token = read('NOTARY_TOKEN');
  if (token && (token.length < 32 || !/^[\x21-\x7e]+$/.test(token))) {
    problems.push(
      'NOTARY_TOKEN must be at least 32 visible ASCII characters; generate one with: openssl rand -base64 32',
    );
  }

  // The key that signs every answer (signing.js). Without it, answers are not signed.
  let signer = null;
  const keyFile = read('SIGNING_KEY_FILE');
  if (keyFile) {
    try {
      signer = createSigner(readFileSync(keyFile));
    } catch (error) {
      const reason =
        error.code === 'ENOENT'
          ? 'no such file (create one with: openssl genpkey -algorithm ed25519 -out <file>)'
          : error.code === 'EACCES'
            ? 'this user may not read it'
            : error.message;
      problems.push(`SIGNING_KEY_FILE ${keyFile}: ${reason}`);
    }
  }

  let upstreamProxy = null;
  if (read('UPSTREAM_PROXY')) {
    try {
      upstreamProxy = new URL(read('UPSTREAM_PROXY'));
      if (upstreamProxy.protocol !== 'http:') {
        throw new Error('not http');
      }
    } catch {
      problems.push('UPSTREAM_PROXY must look like http://host:port');
      upstreamProxy = null;
    }
  }

  const config = {
    port: int('PORT', 8080, 1, 65535),
    host: read('HOST') || '0.0.0.0',
    name: (read('NOTARY_NAME') || os.hostname()).slice(0, 80),
    token,
    signer,
    allowedPorts,
    allowedOrigins,
    requireOrigin: flag('REQUIRE_ORIGIN'),
    ratePerMinute: int('RATE_LIMIT', 30, 0, 100_000),
    healthPerMinute: 60,
    bans: {
      strikes: int('BAN_STRIKES', 5, 1, 1000),
      windowMs: int('BAN_WINDOW_MINUTES', 10, 1, 24 * 60) * MINUTE,
      firstMs: int('BAN_FIRST_MINUTES', 1, 1, 24 * 60) * MINUTE,
      maxMs: int('BAN_MAX_HOURS', 24, 1, 24 * 30) * HOUR,
      alertPerMinute: int('ABUSE_ALERT_PER_MINUTE', 300, 1, 1_000_000),
    },
    globalPerMinute: int('GLOBAL_RATE_LIMIT', 600, 0, 1_000_000),
    maxConcurrent: int('MAX_CONCURRENT', 20, 1, 10_000),
    cacheMs: int('CACHE_SECONDS', 60, 0, 3600) * 1000,
    timeoutMs: int('TIMEOUT_SECONDS', 8, 1, 60) * 1000,
    trustProxy: trustProxy === 0 ? false : trustProxy,
    upstreamProxy,
    allowPrivate: flag('ALLOW_PRIVATE'),
    logHosts: flag('LOG_HOSTS'),
  };

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return Object.freeze(config);
}

function isWebOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}
