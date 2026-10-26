// Asks external "notary" endpoints which certificate chain they see for a host.
//
// Protocol v1 (see notary/README.md):
//   GET <endpoint>?host=<host>&port=<port>     (or a URL template with {host}/{port})
//   Authorization: Bearer <token>              (optional)
//   200 → { version: 1, chain: ["<base64 DER leaf>", ...], vantage, address,
//           observedAt, trusted, trustError, tls: { protocol, cipher, group } }
//   4xx/5xx → { version: 1, error: { code, message } }
// The endpoint must send CORS headers; the extension holds no host permissions.

import { buildEndpointRequestUrl } from '../lib/settings.js';
import { describeChain } from '../lib/x509.js';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_CHAIN_LENGTH = 10;
const MAX_CERT_BASE64 = 64 * 1024;

const text = (value, max = 120) => (typeof value === 'string' ? value.slice(0, max) : null);

function endpointOrigin(url) {
  try {
    return new URL(url.replace(/\{host\}/g, 'x').replace(/\{port\}/g, '443')).origin;
  } catch {
    return null;
  }
}

function httpErrorCode(status, remoteCode) {
  if (remoteCode && /^[a-zA-Z]{2,40}$/.test(remoteCode)) {
    return remoteCode;
  }
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 429) {
    return 'rateLimited';
  }
  return 'http';
}

export async function queryNotary(endpoint, host, port, timeoutMs) {
  const base = {
    id: endpoint.id,
    name: text(endpoint.name, 60) || endpointOrigin(endpoint.url),
    origin: endpointOrigin(endpoint.url),
  };
  const started = Date.now();
  const finish = (extra) => ({ ...base, durationMs: Date.now() - started, ...extra });

  let url;
  try {
    url = buildEndpointRequestUrl(endpoint.url, host, port);
  } catch {
    return finish({ state: 'error', error: { code: 'badEndpoint' } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (endpoint.token) {
      headers.Authorization = `Bearer ${endpoint.token}`;
    }
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) {
      return finish({ state: 'error', error: { code: 'badResponse' } });
    }
    let data = null;
    try {
      data = JSON.parse(body);
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      const remote = data && data.error ? data.error : {};
      return finish({
        state: 'error',
        error: { code: httpErrorCode(res.status, remote.code), status: res.status, message: text(remote.message, 200) },
      });
    }
    if (!data || data.version !== 1 || !Array.isArray(data.chain) || data.chain.length === 0) {
      return finish({ state: 'error', error: { code: 'badResponse' } });
    }
    const chainB64 = data.chain.slice(0, MAX_CHAIN_LENGTH);
    if (!chainB64.every((c) => typeof c === 'string' && c.length > 0 && c.length <= MAX_CERT_BASE64)) {
      return finish({ state: 'error', error: { code: 'badResponse' } });
    }
    const chain = await describeChain(chainB64);
    const tls = data.tls && typeof data.tls === 'object' ? data.tls : {};
    return finish({
      state: 'ok',
      vantage: text(data.vantage),
      address: text(data.address, 64),
      observedAt: text(data.observedAt, 40),
      trusted: typeof data.trusted === 'boolean' ? data.trusted : null,
      trustError: text(data.trustError, 120),
      tls: { protocol: text(tls.protocol, 20), cipher: text(tls.cipher, 80), group: text(tls.group, 40) },
      chain,
    });
  } catch (e) {
    const code =
      e && e.name === 'AbortError'
        ? 'timeout'
        : e && e.name === 'CertificateParseError'
          ? 'badCertificate'
          : e instanceof TypeError
            ? 'network'
            : 'badResponse';
    return finish({ state: 'error', error: { code } });
  } finally {
    clearTimeout(timer);
  }
}
