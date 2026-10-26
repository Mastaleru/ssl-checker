// Turns the local view and the notaries' views into one verdict.
//
// Signals, strongest first:
//  1. Certificate Transparency: Chrome marks a connection "compliant" only when
//     the certificate was publicly logged. Interception CAs (corporate proxies,
//     antivirus, malware) are trusted locally and never logged.
//  2. Comparison with notaries: the same certificate (or at least the same key)
//     seen from elsewhere on the internet means nobody re-signed it on your path.
//  3. Known interception products, used only to name what the signals found.

import { certificateCoversHost } from './hostnames.js';
import { identifyInterceptor } from './interceptors.js';

export const RELATION = {
  SAME_CERTIFICATE: 'sameCertificate',
  SAME_KEY: 'sameKey',
  SAME_ISSUER: 'sameIssuer',
  SAME_CA: 'sameCa',
  DIFFERENT: 'different',
};

const EXPIRY_WARNING_DAYS = 14;
const DAY = 86400000;

function norm(text) {
  return String(text || '')
    .trim()
    .toLowerCase();
}

/** How the certificate a notary saw relates to the one the browser saw. */
export function compareLeaves(a, b) {
  if (a.fingerprints.sha256 === b.fingerprints.sha256) {
    return RELATION.SAME_CERTIFICATE;
  }
  if (a.fingerprints.spkiSha256 === b.fingerprints.spkiSha256) {
    return RELATION.SAME_KEY;
  }
  const akiA = a.extensions.authorityKeyId;
  const akiB = b.extensions.authorityKeyId;
  if (a.issuer.raw === b.issuer.raw && (!akiA || !akiB || akiA === akiB)) {
    return RELATION.SAME_ISSUER;
  }
  const orgA = norm(a.issuer.organization);
  if (orgA && orgA === norm(b.issuer.organization)) {
    return RELATION.SAME_CA;
  }
  return RELATION.DIFFERENT;
}

const isConsistent = (r) => r === RELATION.SAME_CERTIFICATE || r === RELATION.SAME_KEY;
const isSameCa = (r) => r === RELATION.SAME_ISSUER || r === RELATION.SAME_CA;

export function issuerLabel(cert) {
  if (!cert) {
    return '';
  }
  const { commonName, organization } = cert.issuer;
  if (organization && commonName && !commonName.includes(organization)) {
    return commonName.includes('(') ? `${commonName}, ${organization}` : `${commonName} (${organization})`;
  }
  return commonName || organization || cert.issuer.dn;
}

function certificateWarnings(chain, host, now, prefix) {
  const out = [];
  if (!chain || !chain.length) {
    return out;
  }
  const leaf = chain[0];
  const notAfter = Date.parse(leaf.notAfter);
  const notBefore = Date.parse(leaf.notBefore);
  if (now > notAfter) {
    out.push({ code: 'expired', source: prefix });
  } else if (now < notBefore) {
    out.push({ code: 'notYetValid', source: prefix });
  } else if (notAfter - now < EXPIRY_WARNING_DAYS * DAY) {
    out.push({ code: 'expiresSoon', source: prefix, days: Math.max(0, Math.floor((notAfter - now) / DAY)) });
  }
  if (host && !certificateCoversHost(leaf, host)) {
    out.push({ code: 'hostMismatch', source: prefix });
  }
  const nonRoot = chain.filter((c, i) => i === 0 || !c.selfIssued);
  if (nonRoot.some((c) => c.signatureAlgorithm.weak)) {
    out.push({ code: 'weakSignature', source: prefix });
  }
  if (leaf.publicKey.algorithm === 'RSA' && leaf.publicKey.bits && leaf.publicKey.bits < 2048) {
    out.push({ code: 'weakKey', source: prefix, bits: leaf.publicKey.bits });
  }
  return out;
}

/**
 * Folds the site memory (see site-memory.js) into the verdict. Only a change of
 * certificate authority matters: towards a certificate that is not publicly
 * logged it is an alarm, towards a public one it is just worth knowing.
 */
function applyMemory(result, memory) {
  if (!memory || memory.status !== 'changed') {
    return;
  }
  const change = {
    source: 'memory',
    kind: memory.kind,
    sameName: memory.sameName,
    previous: memory.previous ? memory.previous.label : null,
    current: memory.current.label,
  };
  result.memoryChange = change;
  switch (memory.kind) {
    case 'publicToPrivate':
      // The same browser saw a public certificate here before; one that is not
      // publicly logged now points at the path, not at the site.
      if (result.code === 'intercepted' || result.code === 'interceptorDetected') {
        result.warnings.unshift({ code: memory.sameName ? 'caChangedSameName' : 'caChanged', ...change });
      } else {
        result.code = 'caChangedToPrivate';
        result.level = 'danger';
      }
      break;
    case 'privateToPrivate':
      result.warnings.unshift({ code: memory.sameName ? 'caChangedSameName' : 'caChanged', ...change });
      break;
    case 'publicToPublic':
      result.warnings.unshift({ code: 'caChangedPublic', ...change });
      break;
    case 'privateToPublic':
      result.warnings.unshift({ code: 'caChangedNowPublic', ...change });
      break;
    default:
      break;
  }
}

/**
 * @param {object} input
 * @param {{secure:boolean, host:string}} input.target
 * @param {null|{chain:object[], security?:object}} input.local   local view (null when not read)
 * @param {Array<{id:string, state:string, chain?:object[], trusted?:boolean, trustError?:string}>} input.notaries
 * @param {null|object} [input.memory]  site memory assessment (site-memory.js describe())
 * @param {number} [input.now]
 */
export function computeVerdict({ target, local, notaries = [], memory = null, now = Date.now() }) {
  const answered = notaries.filter((n) => n.state === 'ok' && n.chain && n.chain.length);
  const warnings = [];
  const result = {
    code: 'noSources',
    level: 'neutral',
    interceptor: null,
    localIssuer: null,
    externalIssuer: null,
    comparisons: [],
    agreeing: [],
    differing: [],
    counts: {
      asked: notaries.filter((n) => n.state !== 'skipped').length,
      answered: answered.length,
      consistent: 0,
      sameCa: 0,
      different: 0,
    },
    ct: null,
    warnings,
  };

  if (local && local.chain && local.chain.length) {
    const leaf = local.chain[0];
    const ct = (local.security && local.security.certificateTransparencyCompliance) || 'unknown';
    result.ct = ct;
    result.localIssuer = issuerLabel(leaf);
    const publiclyLogged = ct === 'compliant';
    const interceptor = publiclyLogged ? null : identifyInterceptor(local.chain);
    result.interceptor = interceptor;

    for (const n of answered) {
      const relation = compareLeaves(leaf, n.chain[0]);
      result.comparisons.push({ id: n.id, relation });
      if (isConsistent(relation)) {
        result.counts.consistent++;
      } else if (isSameCa(relation)) {
        result.counts.sameCa++;
      } else {
        result.counts.different++;
      }
      (relation === RELATION.DIFFERENT ? result.differing : result.agreeing).push(n.id);
    }
    const firstDifferent = answered.find((n, i) => result.comparisons[i].relation === RELATION.DIFFERENT);
    if (firstDifferent) {
      result.externalIssuer = issuerLabel(firstDifferent.chain[0]);
    }
    const agreeingCount = result.counts.consistent + result.counts.sameCa;
    const confirmedCode = result.counts.consistent > 0 ? 'confirmed' : 'consistentSameCa';

    // Chromium reports CT as "unknown" for certificates that chain to a
    // locally installed root, which is exactly where interception CAs live.
    if (result.counts.different > 0 && agreeingCount > 0) {
      if (publiclyLogged) {
        // Your certificate is public and matches some sources: the odd ones
        // out are seeing something else on their own side.
        result.code = confirmedCode;
        result.level = 'ok';
        warnings.push({
          code: 'someSourcesDiffer',
          source: 'external',
          ids: result.differing.slice(),
          issuer: result.externalIssuer,
        });
      } else {
        result.code = 'split';
        result.level = 'warn';
      }
    } else if (result.counts.different > 0) {
      result.code = publiclyLogged && !interceptor ? 'conflictingPublic' : 'intercepted';
      result.level = result.code === 'intercepted' ? 'danger' : 'warn';
    } else if (answered.length > 0) {
      result.code = confirmedCode;
      result.level = 'ok';
      if (!publiclyLogged) {
        warnings.push({ code: 'notPubliclyLogged', source: 'local' });
      }
    } else if (interceptor) {
      result.code = 'interceptorDetected';
      result.level = 'danger';
    } else if (publiclyLogged) {
      result.code = 'publicLocalOnly';
      result.level = 'ok';
    } else {
      result.code = 'privateCa';
      result.level = 'warn';
    }
    warnings.push(...certificateWarnings(local.chain, null, now, 'local'));
    const protocol = local.security && local.security.protocol;
    if (protocol && /^(SSL|TLS 1(\.0|\.1)?$)/.test(protocol)) {
      warnings.push({ code: 'obsoleteProtocol', source: 'local', protocol });
    }
    applyMemory(result, memory);
  } else if (answered.length > 0) {
    const reference = answered[0].chain[0];
    const agree = answered.every((n) => isConsistent(compareLeaves(reference, n.chain[0])));
    result.code = agree ? 'externalOnly' : 'externalDisagree';
    result.level = agree ? 'info' : 'warn';
    result.externalIssuer = issuerLabel(reference);
    warnings.push(...certificateWarnings(answered[0].chain, target.host, now, 'external'));
  }

  for (const n of answered) {
    if (n.trusted === false) {
      warnings.push({ code: 'notaryUntrusted', source: n.id, reason: n.trustError || null });
    }
  }

  if (!target.secure) {
    // The page itself is plain HTTP; whatever the certificate on 443 looks like,
    // this page was not protected.
    result.code = 'insecureHttp';
    result.level = 'warn';
  }
  return result;
}
