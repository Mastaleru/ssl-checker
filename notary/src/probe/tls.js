// The TLS handshake with the site: returns the certificate chain it presents, as
// seen from this server, in protocol v1 form.
import net from 'node:net';
import tls from 'node:tls';
import { NotaryError } from '../errors.js';
import { resolveTarget } from './target.js';
import { connectThroughProxy } from './upstream.js';

/**
 * @param {string} host  normalized host (see normalizeHost)
 * @param {number} port
 * @param {{ timeoutMs: number, allowPrivate: boolean, upstreamProxy: URL | null, name: string }} options
 */
export async function probeTls(host, port, { timeoutMs, allowPrivate, upstreamProxy, name }) {
  const deadline = Date.now() + timeoutMs;
  // Through an upstream proxy the target is still checked, but the proxy connects to it.
  const address = await resolveTarget(host, { allowPrivate });
  const rawSocket = upstreamProxy ? await connectThroughProxy(upstreamProxy, host, port, deadline) : null;

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      socket: rawSocket || undefined,
      host: rawSocket ? undefined : address,
      port: rawSocket ? undefined : port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false, // trust is reported, not required
      ALPNProtocols: ['h2', 'http/1.1'],
      minVersion: 'TLSv1',
      ciphers: 'DEFAULT:@SECLEVEL=0',
    });
    const timer = setTimeout(
      () => socket.destroy(new NotaryError(504, 'timeout', 'TLS handshake timed out')),
      Math.max(1, deadline - Date.now()),
    );
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cipher = socket.getCipher() || {};
      const ephemeral = socket.getEphemeralKeyInfo() || {};
      const result = {
        version: 1,
        host,
        port,
        observedAt: new Date().toISOString(),
        vantage: name,
        // Through an upstream proxy the target's address is known only to the proxy.
        address: rawSocket ? null : socket.remoteAddress || address,
        trusted: socket.authorized === true,
        trustError: socket.authorized ? null : String(socket.authorizationError || 'unknown'),
        tls: {
          protocol: socket.getProtocol() || null,
          cipher: cipher.standardName || cipher.name || null,
          group: ephemeral.name || null,
        },
        chain: peerChain(socket),
      };
      socket.end();
      if (result.chain.length === 0) {
        reject(new NotaryError(502, 'tlsFailed', 'server sent no certificate'));
      } else {
        resolve(result);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      if (error instanceof NotaryError) {
        reject(error);
        return;
      }
      const code = /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE/.test(error.code || '')
        ? 'connectFailed'
        : 'tlsFailed';
      reject(new NotaryError(502, code, error.code || error.message));
    });
  });
}

function peerChain(socket) {
  const chain = [];
  const seen = new Set();
  let cert = socket.getPeerCertificate(true);
  while (cert && cert.raw && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    chain.push(cert.raw.toString('base64'));
    if (!cert.issuerCertificate || cert.issuerCertificate === cert) {
      break;
    }
    cert = cert.issuerCertificate;
  }
  return chain;
}
