// Small middleware shared by all routes: response headers, methods, 404 and errors.
import { NotaryError, errorBody } from '../errors.js';

export function baseHeaders(req, res, next) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
}

export function onlyGet(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  next(new NotaryError(405, 'badRequest', 'only GET is supported', { Allow: 'GET, OPTIONS' }));
}

export function notFound(req, res, next) {
  next(new NotaryError(404, 'badRequest', 'unknown path; use /v1/cert or /v1/health'));
}

export function errorHandler(logger) {
  // Express recognizes error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  return function sendError(error, req, res, next) {
    if (error instanceof NotaryError) {
      if (error.headers) {
        res.set(error.headers);
      }
      res.status(error.status).json(errorBody(error.code, error.message));
      return;
    }
    // Errors from Express itself, such as a malformed path, carry a 4xx status.
    const status = Number(error?.status || error?.statusCode);
    if (status >= 400 && status < 500) {
      res.status(status).json(errorBody('badRequest', 'malformed request'));
      return;
    }
    logger.error('unexpected error', { error: error?.stack || String(error) });
    res.status(500).json(errorBody('internal', 'internal error'));
  };
}
