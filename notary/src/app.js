// The Express application. The middleware runs in the order listed here; a new
// endpoint is a handler in routes/ plus its lines below (see README.md).
import express from 'express';
import { accessLog } from './log.js';
import { bearerToken } from './middleware/auth.js';
import { baseHeaders, errorHandler, notFound, onlyGet } from './middleware/common.js';
import { clientKey, perClientLimit } from './middleware/limits.js';
import { originCheck } from './middleware/origin.js';
import { certRoute } from './routes/cert.js';
import { healthRoute } from './routes/health.js';

/**
 * @param {object} deps
 * @param {ReturnType<import('./config.js').loadConfig>} deps.config
 * @param {ReturnType<import('./log.js').createLogger>} deps.logger
 * @param {ReturnType<import('./middleware/bans.js').createBans>} deps.bans
 * @param {ReturnType<import('./probe/service.js').createCertService>} deps.service
 */
export function createApp({ config, logger, bans, service }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // answers are never cached anyway (Cache-Control: no-store)
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  app.use(accessLog(logger, config));
  app.use(baseHeaders);

  const strike = (reason) => (req) => bans.strike(clientKey(req), reason);

  // Health: open to anyone (monitors send no Origin), with a loose limit.
  app.use(
    '/v1/health',
    originCheck({ allowedOrigins: config.allowedOrigins, enforce: false }),
    perClientLimit({ perMinute: config.healthPerMinute }),
    onlyGet,
  );
  app.get('/v1/health', healthRoute({ config }));

  // Certificates: every check runs before the notary contacts a site.
  app.use(
    '/v1/cert',
    originCheck({
      allowedOrigins: config.allowedOrigins,
      requireOrigin: config.requireOrigin,
      onRefused: strike('origin'),
    }),
    bans.guard(clientKey),
    bearerToken({ token: config.token, onFailure: strike('token') }),
    perClientLimit({ perMinute: config.ratePerMinute, onLimited: strike('rate') }),
    onlyGet,
  );
  app.get('/v1/cert', certRoute({ config, service }));

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
