// Asks external "notary" endpoints which certificate chain they see for a host.
//
// Protocol v1 (see notary/README.md):
//   POST <endpoint>  {"host": "<host>", "port": <port>, "nonce": "<nonce>"}
//     (a URL template with {host}/{port} gets a GET instead, with the nonce in its query)
//   Authorization: Bearer <token>                          (optional)
//   200 → { version: 1, chain: ["<base64 DER leaf>", ...], vantage, address,
//           observedAt, trusted, trustError, tls: { protocol, cipher, group }, nonce, key }
//         + Notary-Signature: <Ed25519 signature>          (notaries with a signing key)
//   4xx/5xx → { version: 1, error: { code, message } }
// The endpoint must send CORS headers; the extension holds no host permissions.
// For a notary whose keys are known (always the PlusPrivacy one), an answer counts
// only when its signature holds (lib/notary-signature.js).

import { checkSignature, newNonce, SIGNATURE_HEADER } from '../lib/notary-signature.js';
import { buildNotaryRequest } from '../lib/settings.js';
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

// The protocol's error codes (notary/README.md). Error bodies are not signed, so any
// other code is ignored: a server or an interceptor must not be able to claim a code
// the extension sets itself, such as "tampered". Their messages are not shown either.
const REMOTE_ERRORS = new Set([
  'badRequest',
  'unauthorized',
  'forbiddenOrigin',
  'forbiddenTarget',
  'forbiddenPort',
  'rateLimited',
  'dnsFailed',
  'connectFailed',
  'tlsFailed',
  'busy',
  'timeout',
  'internal',
]);

function httpErrorCode(status, remoteCode) {
  if (REMOTE_ERRORS.has(remoteCode)) {
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

  const keys = Array.isArray(endpoint.keys) ? endpoint.keys : [];
  const signed = Boolean(endpoint.requireSignature) || keys.length > 0;
  if (signed && keys.length === 0) {
    // A build without the PlusPrivacy key: nothing it answered could be checked.
    return finish({ state: 'error', error: { code: 'noKey' } });
  }

  let request;
  try {
    request = buildNotaryRequest(endpoint.url, host, port);
  } catch {
    return finish({ state: 'error', error: { code: 'badEndpoint' } });
  }
  const nonce = newNonce();
  const headers = { Accept: 'application/json' };
  if (endpoint.token) {
    headers.Authorization = `Bearer ${endpoint.token}`;
  }
  // What the notary is asked to look at, which its signed answer must repeat.
  let asked;
  let url;
  let payload;
  if (request.method === 'POST') {
    asked = request.target;
    url = request.url;
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify({ host: asked.host, port: asked.port, nonce });
  } else {
    const u = new URL(request.url);
    u.searchParams.set('nonce', nonce);
    url = u.toString();
    // A URL template may fix a host of its own.
    asked = { host: u.searchParams.get('host'), port: Number(u.searchParams.get('port') || 443) };
  }
  if (signed && !asked.host) {
    return finish({ state: 'error', error: { code: 'badEndpoint' } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: request.method,
      headers,
      body: payload,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    // Raw bytes: a signature covers exactly what was sent.
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.length > MAX_BODY_BYTES) {
      return finish({ state: 'error', error: { code: 'badResponse' } });
    }
    let data = null;
    try {
      data = JSON.parse(new TextDecoder().decode(body));
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      const remote = data && data.error ? data.error : {};
      return finish({ state: 'error', error: { code: httpErrorCode(res.status, remote.code), status: res.status } });
    }
    if (!data || data.version !== 1 || !Array.isArray(data.chain) || data.chain.length === 0) {
      return finish({ state: 'error', error: { code: 'badResponse' } });
    }
    const signature = await checkSignature({
      body,
      signature: res.headers.get(SIGNATURE_HEADER),
      answer: data,
      keys,
      nonce,
      host: asked.host,
      port: asked.port,
    });
    if (signed && signature.status !== 'verified') {
      // unsigned, unknownKey, tampered or cannotVerify: the answer is not used.
      return finish({ state: 'error', error: { code: signature.status, reason: signature.reason || null } });
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
      signed: signature.status === 'verified',
      // A notary nobody pinned may still sign: Options shows its key.
      reportedKey: signature.status === 'selfSigned' ? text(signature.key, 60) : null,
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
