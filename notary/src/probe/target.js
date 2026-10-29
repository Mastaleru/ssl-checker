// Which targets the notary agrees to contact (SSRF protection).
//
// The host name is resolved first and every private, loopback, link-local, CGNAT,
// multicast or documentation address is refused, IPv6 equivalents included. The
// probe then connects to the address that was checked, so DNS rebinding cannot
// swap the target between the check and the connection.
import dns from 'node:dns/promises';
import net from 'node:net';
import { NotaryError } from '../errors.js';

// Two separate lists: Node's BlockList compares IPv4 addresses with IPv6 rules
// as IPv4-mapped addresses, so a ::ffff:0:0/96 rule in a shared list would
// block every IPv4 address.
const blockedV4 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blockedV4.addSubnet(address, prefix, 'ipv4');
}

const blockedV6 = new net.BlockList();
for (const [address, prefix] of [
  // IPv4-mapped (::ffff:0:0/96), NAT64 and 6to4 embed IPv4 addresses: refused outright.
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blockedV6.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    return blockedV4.check(address, 'ipv4');
  }
  if (family === 6) {
    return blockedV6.check(address, 'ipv6');
  }
  return true;
}

/** Validates the requested host and returns it lower-cased, IDNs in ASCII (punycode). */
export function normalizeHost(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!value || value.length > 253) {
    throw new NotaryError(400, 'badRequest', 'host is missing or too long');
  }
  if (net.isIP(value)) {
    return value;
  }
  let ascii;
  try {
    ascii = new URL(`https://${value}/`).hostname;
  } catch {
    throw new NotaryError(400, 'badRequest', 'host is not a valid name');
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(ascii)) {
    throw new NotaryError(400, 'badRequest', 'host is not a valid name');
  }
  // Names are only checked for syntax here; the resolved address decides whether
  // the target is public (resolveTarget), which also covers single-label names.
  return ascii;
}

/** Resolves the host and returns the first public address, or refuses the target. */
export async function resolveTarget(host, { allowPrivate = false, lookup = dns.lookup } = {}) {
  if (net.isIP(host)) {
    if (!allowPrivate && isBlockedAddress(host)) {
      throw new NotaryError(403, 'forbiddenTarget', 'address is private or reserved');
    }
    return host;
  }
  let records;
  try {
    records = await withTimeout(lookup(host, { all: true, verbatim: true }), 4000, 'dns');
  } catch (error) {
    if (error instanceof NotaryError) {
      throw error;
    }
    throw new NotaryError(502, 'dnsFailed', `could not resolve ${host}`);
  }
  const usable = records.map((r) => r.address).filter((a) => allowPrivate || !isBlockedAddress(a));
  if (usable.length === 0) {
    throw new NotaryError(403, 'forbiddenTarget', 'name resolves only to private or reserved addresses');
  }
  return usable[0];
}

export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new NotaryError(504, 'timeout', `${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
