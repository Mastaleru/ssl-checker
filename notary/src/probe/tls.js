// The TLS handshake with the site: returns the certificate chain it presents, as
// seen from this server, in protocol v1 form.
import net from 'node:net';
import tls from 'node:tls';
import { NotaryError } from '../errors.js';
import { resolveTargets } from './target.js';
import { connectThroughProxy } from './upstream.js';

/**
 * @param {string} host  normalized host (see normalizeHost)
 * @param {number} port
 * @param {{ timeoutMs: number, allowPrivate: boolean, upstreamProxy: URL | null, name: string }} options
 */
export async function probeTls(host, port, { timeoutMs, allowPrivate, upstreamProxy, name, ipFamily }) {
  const deadline = Date.now() + timeoutMs;
  // Through an upstream proxy the target is still checked, but the proxy connects to it.
  // Resolve exactly once and retain only addresses that passed the SSRF checks.
  // The TCP connection below must not perform an independent DNS lookup.
  const targets = await resolveTargets(host, {
    allowPrivate,
    family: ipFamily,
  });

  const rawSocket = upstreamProxy
    ? await connectThroughProxy(upstreamProxy, host, port, deadline)
    : null;

  const literalHost = net.isIP(host) !== 0;

  const useHappyEyeballs =
    !rawSocket &&
    !literalHost &&
    ipFamily === 0 &&
    targets.some((target) => target.family === 4) &&
    targets.some((target) => target.family === 6);

  const directAddress =
    !rawSocket && !useHappyEyeballs
      ? targets[0].address
      : null;

  const lookup = createValidatedLookup(targets);

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      socket: rawSocket || undefined,

      host: rawSocket
        ? undefined
        : useHappyEyeballs
          ? host
          : directAddress,

      port: rawSocket ? undefined : port,

      servername: literalHost ? undefined : host,

      lookup: useHappyEyeballs ? lookup : undefined,
      autoSelectFamily: useHappyEyeballs,
      autoSelectFamilyAttemptTimeout: useHappyEyeballs ? 250 : undefined,

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
        address: rawSocket
          ? null
          : socket.remoteAddress || targets[0].address,
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

      const codes = [
        error.code,
        ...(Array.isArray(error.errors)
          ? error.errors.map((item) => item?.code)
          : []),
      ].filter(Boolean);

      const connectionError = codes.some((code) =>
        /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|EPIPE/.test(
          code,
        ),
      );

      reject(
        new NotaryError(
          502,
          connectionError ? 'connectFailed' : 'tlsFailed',
          codes.join(',') || error.message,
        ),
      );
    });
  });
}

/**
 * Supplies only addresses that were already resolved and checked.
 * No second DNS request is made during the TCP connection.
 */
function createValidatedLookup(targets) {
  const frozen = targets.map(({ address, family }) => ({
    address,
    family,
  }));

  return function validatedLookup(hostname, options, callback) {
    const requestedFamily =
      typeof options === 'number'
        ? options
        : Number(options?.family || 0);

    const usable = requestedFamily
      ? frozen.filter((target) => target.family === requestedFamily)
      : frozen;

    if (usable.length === 0) {
      const error = Object.assign(
        new Error(
          `no validated IPv${requestedFamily} address for ${hostname}`,
        ),
        { code: 'ENOTFOUND' },
      );
      callback(error);
      return;
    }

    if (typeof options === 'object' && options?.all) {
      callback(null, usable);
      return;
    }

    callback(null, usable[0].address, usable[0].family);
  };
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
