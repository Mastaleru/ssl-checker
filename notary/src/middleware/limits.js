// Per-client rate limits (express-rate-limit).
//
// Clients are keyed by address. Express derives `req.ip` from X-Forwarded-For only
// for the proxies that TRUST_PROXY names, so behind Caddy it is the address Caddy
// saw, which a client cannot forge. IPv6 addresses count per /64 network, because
// one machine can rotate through a whole /64.
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { NotaryError } from '../errors.js';

export const clientKey = (req) => ipKeyGenerator(req.ip ?? '', 64);

/**
 * @param {object} options
 * @param {number} options.perMinute  0 = no limit
 * @param {(req: import('express').Request) => void} [options.onLimited]
 */
export function perClientLimit({ perMinute, onLimited = () => {} }) {
  if (!perMinute) {
    return (req, res, next) => next();
  }
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientKey,
    handler: (req, res, next) => {
      onLimited(req);
      next(new NotaryError(429, 'rateLimited', 'too many requests'));
    },
  });
}
