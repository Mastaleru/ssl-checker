// GET /v1/cert?host=example.com&port=443 → the certificate chain, as seen from here.
import { NotaryError } from '../errors.js';
import { normalizeHost } from '../probe/target.js';

function single(value, name) {
  if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) {
    throw new NotaryError(400, 'badRequest', `give ${name} once`);
  }
  return value;
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

export function certRoute({ config, service }) {
  return async function certificate(req, res) {
    const host = normalizeHost(single(req.query.host, 'host'));
    const port = parsePort(single(req.query.port, 'port'), config.allowedPorts);
    res.locals.target = `${host}:${port}`;
    const { value, cached } = await service.lookup(host, port);
    res.locals.cached = cached;
    res.json(value);
  };
}
