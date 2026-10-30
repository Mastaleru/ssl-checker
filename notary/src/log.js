// JSON lines on stdout, one per event, for `docker compose logs`.
// The access log never contains client addresses, tokens or query strings; the
// checked host appears only with LOG_HOSTS=1.

export function createLogger(stream = process.stdout) {
  const write = (level, msg, fields = {}) => {
    stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

export const silentLogger = { info() {}, warn() {}, error() {} };

export function accessLog(logger, { logHosts }) {
  return function logRequest(req, res, next) {
    const started = process.hrtime.bigint();
    const path = req.path; // read now: mounted middleware sees a shortened path
    res.on('finish', () => {
      const fields = {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      };
      if (res.locals.cached) {
        fields.cached = true;
      }
      if (logHosts && res.locals.target) {
        fields.target = res.locals.target;
      }
      logger.info('request', fields);
    });
    next();
  };
}
