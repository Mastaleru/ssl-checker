// Site memory: remembers which certificate authority (CA) issued the
// certificate of each site the user checks, and spots when that changes.
//
// Leaf certificates are renewed every few months and CAs rotate their
// intermediates, so neither is remembered as such. A CA is identified by the
// organization in the leaf's issuer name ("Let's Encrypt", "Google Trust
// Services"), and the keys of its issuing certificates are kept alongside, so a
// look-alike CA with a borrowed name is still told apart unless its certificate
// is publicly logged.
//
// Pure functions only; storage lives in site-memory-store.js.

import { issuerLabel } from './verdict.js';

const MAX_CAS_PER_SITE = 10;
const MAX_ISSUER_KEYS_PER_CA = 8;
const DAY = 86400000;

const LEGAL_SUFFIXES = new Set([
  'ab',
  'ag',
  'as',
  'bv',
  'co',
  'company',
  'corp',
  'corporation',
  'gmbh',
  'inc',
  'incorporated',
  'kk',
  'limited',
  'llc',
  'ltd',
  'nv',
  'oy',
  'plc',
  'pte',
  'pty',
  'sa',
  'sas',
  'spa',
  'srl',
]);

/** "Google Trust Services LLC" and "Google Trust Services" → "google trust services". */
export function normalizeOrganization(name) {
  const words = String(name || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1') // s.r.l. → srl, n.v. → nv
    .replace(/\b([a-z])\.(?=\s|$)/g, '$1')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const kept = words.filter((w) => !LEGAL_SUFFIXES.has(w));
  return (kept.length ? kept : words).join(' ');
}

/** Chrome marks a connection CT-compliant only for publicly logged certificates. */
export function isPublicConnection(local) {
  return Boolean(local && local.security && local.security.certificateTransparencyCompliance === 'compliant');
}

/** What a successful local reading says about the site's CA. */
export function observationFrom(local, at) {
  const [leaf, issuerCert = leaf] = local.chain;
  const org = normalizeOrganization(leaf.issuer.organization);
  const key = org ? `o:${org}` : `cn:${normalizeOrganization(leaf.issuer.commonName || leaf.issuer.dn)}`;
  return {
    key,
    label: issuerLabel(leaf),
    public: isPublicConnection(local),
    issuerKey: issuerCert.fingerprints.spkiSha256,
    at,
  };
}

function mostRecent(entries) {
  return entries.reduce((best, entry) => (!best || entry.lastSeen > best.lastSeen ? entry : best), null);
}

/**
 * Compares an observation with what is remembered for the site.
 * Returns { status: 'first' | 'known' | 'changed', kind?, sameName?, previous?, autoLearn }.
 * kind tells the direction of a change: publicToPublic, privateToPublic,
 * publicToPrivate or privateToPrivate ("public" meaning publicly logged).
 * Only changes towards a public certificate are learned automatically.
 */
export function assess(record, observation) {
  if (!record || !record.cas || record.cas.length === 0) {
    return { status: 'first', autoLearn: true };
  }

  const entry = record.cas.find((ca) => ca.key === observation.key);
  if (entry && (entry.issuerKeys.includes(observation.issuerKey) || observation.public)) {
    return { status: 'known', autoLearn: true };
  }
  if (entry) {
    // Same CA name, a signing key never seen for this site, not publicly logged.
    return {
      status: 'changed',
      kind: entry.public ? 'publicToPrivate' : 'privateToPrivate',
      sameName: true,
      previous: entry,
      autoLearn: false,
    };
  }

  const publicEntries = record.cas.filter((ca) => ca.public);
  const wasPublic = publicEntries.length > 0;
  const kind = observation.public
    ? wasPublic
      ? 'publicToPublic'
      : 'privateToPublic'
    : wasPublic
      ? 'publicToPrivate'
      : 'privateToPrivate';
  return {
    status: 'changed',
    kind,
    sameName: false,
    previous: mostRecent(wasPublic ? publicEntries : record.cas),
    autoLearn: observation.public,
  };
}

/** Returns a new record with the observation added (or counted again). */
export function learn(record, observation, site) {
  const next = record
    ? { ...record, cas: record.cas.map((ca) => ({ ...ca, issuerKeys: [...ca.issuerKeys] })) }
    : { v: 1, host: site.host, port: site.port, cas: [] };
  let entry = next.cas.find((ca) => ca.key === observation.key);
  if (!entry) {
    entry = {
      key: observation.key,
      label: observation.label,
      public: false,
      issuerKeys: [],
      firstSeen: observation.at,
      lastSeen: observation.at,
      count: 0,
    };
    next.cas.push(entry);
  }
  entry.label = observation.label;
  entry.public = entry.public || observation.public;
  entry.lastSeen = observation.at;
  entry.count += 1;
  if (!entry.issuerKeys.includes(observation.issuerKey)) {
    entry.issuerKeys.push(observation.issuerKey);
    if (entry.issuerKeys.length > MAX_ISSUER_KEYS_PER_CA) {
      entry.issuerKeys.shift();
    }
  }
  if (next.cas.length > MAX_CAS_PER_SITE) {
    next.cas.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    next.cas.length = MAX_CAS_PER_SITE;
  }
  return next;
}

const entrySummary = (ca) =>
  ca && { label: ca.label, public: ca.public, firstSeen: ca.firstSeen, lastSeen: ca.lastSeen, count: ca.count };

/** Plain data for the popup and the verdict. `record` is what is stored after this check. */
export function describe(assessment, record, observation) {
  const stored = record && record.cas.find((ca) => ca.key === observation.key);
  return {
    status: assessment.status,
    kind: assessment.kind || null,
    sameName: Boolean(assessment.sameName),
    learned: Boolean(assessment.autoLearn),
    current: { label: observation.label, public: observation.public },
    previous: entrySummary(assessment.previous) || null,
    entry: assessment.autoLearn ? entrySummary(stored) || null : null,
  };
}

/** Latest time any CA of the record was seen. */
export function lastSeenOf(record) {
  return record && record.cas
    ? record.cas.reduce((latest, ca) => (ca.lastSeen > latest ? ca.lastSeen : latest), '')
    : '';
}

/** Keys of the records to delete: unseen for maxAgeDays, then the oldest beyond maxSites. */
export function recordsToPrune(entries, now, { maxSites = 5000, maxAgeDays = 400 } = {}) {
  const cutoff = now - maxAgeDays * DAY;
  return entries
    .slice()
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
    .filter((entry, index) => index >= maxSites || !entry.lastSeen || Date.parse(entry.lastSeen) < cutoff)
    .map((entry) => entry.key);
}
