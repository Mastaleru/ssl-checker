// Reaching sites through an HTTP CONNECT proxy (UPSTREAM_PROXY). If that proxy
// inspects TLS, the notary sees the interception too: useful for testing.
import http from 'node:http';
import { NotaryError } from '../errors.js';

export function connectThroughProxy(proxy, host, port, deadline) {
  return new Promise((resolve, reject) => {
    const target = `${host.includes(':') ? `[${host}]` : host}:${port}`;
    const request = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: target,
      headers: { Host: target },
      timeout: Math.max(1, deadline - Date.now()),
    });
    request.once('connect', (response, socket) => {
      if (response.statusCode === 200) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(new NotaryError(502, 'connectFailed', `upstream proxy answered ${response.statusCode}`));
      }
    });
    request.once('timeout', () => request.destroy(new NotaryError(504, 'timeout', 'upstream proxy timed out')));
    request.once('error', (error) =>
      reject(
        error instanceof NotaryError ? error : new NotaryError(502, 'connectFailed', 'upstream proxy unreachable'),
      ),
    );
    request.end();
  });
}
