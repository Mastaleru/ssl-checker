// Optional bearer token (NOTARY_TOKEN), for a private notary. A public notary, like
// the one the extension uses by default, has none: a token shipped inside a public
// extension would protect nothing. Every wrong token is a strike (see bans.js).
import crypto from 'node:crypto';
import { NotaryError } from '../errors.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

export function bearerToken({ token, onFailure = () => {} }) {
  if (!token) {
    return (req, res, next) => next();
  }
  const expected = sha256(token);
  return function checkToken(req, res, next) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(req.get('Authorization') || '');
    // Comparing hashes keeps the comparison constant-time whatever the length sent.
    if (match && crypto.timingSafeEqual(sha256(match[1]), expected)) {
      next();
      return;
    }
    onFailure(req);
    next(new NotaryError(401, 'unauthorized', 'missing or wrong bearer token'));
  };
}
