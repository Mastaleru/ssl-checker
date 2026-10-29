// GET /v1/health → liveness and what this notary accepts. Used by the extension's
// "Test" button in Options, by Docker's health check and by uptime monitors.

export function healthRoute({ config }) {
  return function health(req, res) {
    res.json({
      version: 1,
      ok: true,
      vantage: config.name,
      ports: [...config.allowedPorts],
      auth: Boolean(config.token),
      key: config.signer ? config.signer.publicKey : null,
    });
  };
}
