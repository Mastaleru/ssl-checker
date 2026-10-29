// Starts the notary: reads the configuration, listens, and stops cleanly on
// SIGTERM (docker stop) or SIGINT (Ctrl+C).
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createBans } from './middleware/bans.js';
import { createCertService } from './probe/service.js';
import { probeTls } from './probe/tls.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  throw error;
}

const logger = createLogger();
const bans = createBans({ ...config.bans, logger });
const service = createCertService({
  probe: (host, port) => probeTls(host, port, config),
  cacheMs: config.cacheMs,
  maxConcurrent: config.maxConcurrent,
  globalPerMinute: config.globalPerMinute,
});
const app = createApp({ config, logger, bans, service });

const server = app.listen(config.port, config.host, () => {
  logger.info('listening', {
    address: `${config.host}:${config.port}`,
    vantage: config.name,
    ports: [...config.allowedPorts],
    origins: config.allowedOrigins.length > 0 ? config.allowedOrigins : 'any',
    requireOrigin: config.requireOrigin,
    auth: Boolean(config.token),
    trustProxy: config.trustProxy,
    // The public key to build into the extension (lib/default-notary.js) or to give to Options.
    key: config.signer ? config.signer.publicKey : null,
    ...(config.allowPrivate ? { warning: 'ALLOW_PRIVATE=1: private targets allowed (testing only)' } : {}),
  });
  if (!config.signer) {
    logger.warn('answers are not signed', { hint: 'set SIGNING_KEY_FILE (README.md, "Signed answers")' });
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

setInterval(() => bans.sweep(), 60_000).unref();

function shutdown(signal) {
  logger.info('stopping', { signal });
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
