// POST /v1/cert {"host":"example.com","port":443,"nonce":"…"}, or
// GET /v1/cert?host=example.com&port=443&nonce=… → the certificate chain, as seen from here.
import { NotaryError } from '../errors.js';
import { normalizeHost } from '../probe/target.js';
import { SIGNATURE_HEADER } from '../signing.js';

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

function single(value, name) {
  if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) {
    throw new NotaryError(400, 'badRequest', `give ${name} once`);
  }
  return value;
}

/**
 * What to check, as text, from the JSON body of a POST (the extension's way: the
 * site's name stays out of URLs and logs) or from the query string of a GET.
 */
function readTarget(req) {
  if (req.method !== 'POST') {
    return {
      host: single(req.query.host, 'host'),
      port: single(req.query.port, 'port'),
      nonce: single(req.query.nonce, 'nonce'),
    };
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new NotaryError(
      400,
      'badRequest',
      'send {"host", "port", "nonce"} as JSON, with Content-Type: application/json',
    );
  }
  const { host, port, nonce } = body;
  if (host !== undefined && typeof host !== 'string') {
    throw new NotaryError(400, 'badRequest', 'host must be a string');
  }
  if (port !== undefined && !Number.isInteger(port)) {
    throw new NotaryError(400, 'badRequest', 'port must be a number from 1 to 65535');
  }
  if (nonce !== undefined && typeof nonce !== 'string') {
    throw new NotaryError(400, 'badRequest', 'nonce must be a string');
  }
  return { host, port: port === undefined ? undefined : String(port), nonce };
}

function parsePort(raw, allowedPorts) {
  if (raw === undefined || raw === '') {
    return 443;
  }
  const port = Number(raw);
  if (!/^\d{1,5}$/.test(raw) || port < 1 || port > 65535) {
    throw new NotaryError(400, 'badRequest', 'port must be a number from 1 to 65535');
  }
  if (!allowedPorts.has(port)) {
    throw new NotaryError(403, 'forbiddenPort', `port ${port} is not allowed here`);
  }
  return port;
}

// The client's random value, echoed in the signed answer, ties the answer to this
// request: an old answer replayed later carries another nonce.
function parseNonce(raw) {
  if (raw === undefined || raw === '') {
    return null;
  }
  if (!NONCE.test(raw)) {
    throw new NotaryError(400, 'badRequest', 'nonce must be 16 to 128 characters from A-Z, a-z, 0-9, - and _');
  }
  return raw;
}

export function certRoute({ config, service }) {
  return async function certificate(req, res) {
    const target = readTarget(req);
    const host = normalizeHost(target.host);
    const port = parsePort(target.port, config.allowedPorts);
    const nonce = parseNonce(target.nonce);
    res.locals.target = `${host}:${port}`;
    const { value, cached } = await service.lookup(host, port);
    res.locals.cached = cached;
    // Serialized here, because the signature covers exactly the bytes that are sent.
    const { signer } = config;
    const body = Buffer.from(JSON.stringify({ ...value, nonce, key: signer ? signer.publicKey : null }));
    if (signer) {
      res.set(SIGNATURE_HEADER, signer.sign(body));
    }
    res.type('application/json').send(body);
  };
}
