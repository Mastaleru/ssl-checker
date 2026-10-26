// Hostname helpers: certificate name matching and "is this host reachable from
// the public internet" heuristics (external notaries cannot see internal hosts).

/** Parses an http(s) URL into the target we check. Returns null for other schemes. */
export function parseTarget(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return null;
  const secure = u.protocol === 'https:';
  // For plain-HTTP pages we still look at the HTTPS certificate on port 443.
  const port = secure ? Number(u.port || 443) : 443;
  return { secure, host, port, origin: u.origin };
}

function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

export function isIpLiteral(host) {
  return parseIPv4(host) !== null || host.includes(':');
}

/** True for loopback, private, link-local and reserved names that public notaries cannot reach. */
export function isInternalHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = parseIPv4(h);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (h.includes(':')) {
    return h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  if (!h.includes('.')) return true; // single-label intranet names
  return /\.(local|internal|intranet|lan|home|corp|home\.arpa|test|example|invalid)$/.test(h);
}

function normalizeIp(ip) {
  return String(ip).toLowerCase().replace(/^\[|\]$/g, '');
}

function matchesDnsName(pattern, host) {
  const p = pattern.toLowerCase().replace(/\.$/, '');
  if (p === host) return true;
  if (!p.startsWith('*.')) return false;
  const suffix = p.slice(1);
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, host.length - suffix.length);
  return label.length > 0 && !label.includes('.');
}

/**
 * Whether a certificate (as returned by describeCertificate) covers `host`.
 * Like Chrome, only subjectAltName is considered; the subject CN is ignored.
 */
export function certificateCoversHost(cert, host) {
  const san = cert && cert.extensions && cert.extensions.subjectAltName;
  if (!san) return false;
  const h = normalizeIp(host).replace(/\.$/, '');
  if (isIpLiteral(h)) return san.ip.some((ip) => normalizeIp(ip) === h);
  return san.dns.some((name) => matchesDnsName(name, h));
}
