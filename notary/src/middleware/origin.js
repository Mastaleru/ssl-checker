// CORS headers for the extension, and the Origin check.
//
// Chrome sends `Origin: chrome-extension://<extension id>` on every request the
// extension makes, and no web page can change it. With ALLOWED_ORIGINS set, other
// websites cannot use their visitors' browsers to query the notary. Scripts outside
// a browser can send any Origin; the rate limits and bans deal with those.
import { NotaryError } from '../errors.js';
import { SIGNATURE_HEADER } from '../signing.js';

/**
 * @param {object} options
 * @param {string[]} options.allowedOrigins  empty = any origin
 * @param {boolean} [options.requireOrigin]  refuse requests that carry no Origin
 * @param {boolean} [options.enforce]        false = only add the CORS headers
 * @param {string[]} [options.methods]       the methods the path answers, besides OPTIONS
 * @param {(req: import('express').Request) => void} [options.onRefused]
 */
export function originCheck({
  allowedOrigins,
  requireOrigin = false,
  enforce = true,
  methods = ['GET'],
  onRefused = () => {},
}) {
  const anyOrigin = allowedOrigins.length === 0;
  const allowed = new Set(allowedOrigins);
  const allowMethods = [...methods, 'OPTIONS'].join(', ');

  return function checkOrigin(req, res, next) {
    const origin = req.get('Origin');
    if (anyOrigin) {
      res.set('Access-Control-Allow-Origin', '*');
    } else {
      res.vary('Origin');
      if (origin && allowed.has(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
      }
    }
    res.set({
      // Content-Type: the extension posts its question as JSON.
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': allowMethods,
      'Access-Control-Max-Age': '600',
      // Without this, the extension could not read the signature of an answer.
      'Access-Control-Expose-Headers': SIGNATURE_HEADER,
    });

    const accepted = origin ? anyOrigin || allowed.has(origin) : !requireOrigin;
    if (enforce && !accepted) {
      onRefused(req);
      if (origin) {
        // Let the caller read why it was refused (an unpacked copy of the extension
        // has another ID); the answer holds nothing but this error.
        res.set('Access-Control-Allow-Origin', origin);
      }
      next(
        new NotaryError(
          403,
          'forbiddenOrigin',
          origin ? 'this origin may not use the notary' : 'requests must come from the SSL Checker extension',
        ),
      );
      return;
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
