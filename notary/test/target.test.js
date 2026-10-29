import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlockedAddress, normalizeHost, resolveTarget } from '../src/probe/target.js';

test('host names are normalized; IDNs become punycode', () => {
  assert.equal(normalizeHost(' Example.COM. '), 'example.com');
  assert.equal(normalizeHost('[2606:4700::1111]'), '2606:4700::1111');
  assert.equal(normalizeHost('bücher.de'), 'xn--bcher-kva.de');
  const bad = ['', 'not a host', 'exa_mple.com', 'a..b', `${'a'.repeat(300)}.com`];
  // What a URL parser would silently trim to another host or port.
  bad.push('example.com:8443', 'user@example.com', 'example.com/path', 'example.com?x', 'b%C3%BCcher.de', 'a\\b.com');
  for (const host of bad) {
    assert.throws(() => normalizeHost(host), { code: 'badRequest' }, JSON.stringify(host));
  }
});

test('private, reserved and IPv4-embedding addresses are blocked', () => {
  const blocked = [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.17.0.1',
    '192.168.1.1',
    '100.64.1.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    'fd00::1',
    'fe80::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    'not-an-ip',
  ];
  for (const address of blocked) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.215.14', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('a name is resolved and its first public address is used', async () => {
  const lookup = async () => [{ address: '10.0.0.5' }, { address: '93.184.215.14' }];
  assert.equal(await resolveTarget('example.com', { lookup }), '93.184.215.14');
});

test('a name with only private addresses is refused; DNS failures are reported', async () => {
  await assert.rejects(resolveTarget('internal.example', { lookup: async () => [{ address: '192.168.0.10' }] }), {
    code: 'forbiddenTarget',
  });
  await assert.rejects(
    resolveTarget('missing.example', {
      lookup: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      },
    }),
    { code: 'dnsFailed' },
  );
  assert.equal(
    await resolveTarget('internal.example', { allowPrivate: true, lookup: async () => [{ address: '10.0.0.5' }] }),
    '10.0.0.5',
  );
});
