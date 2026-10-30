// Loaded into the test notaries with --import. They resolve the test site's names to
// 127.0.0.2, where only the real server answers, on every port the tests use: like a
// notary elsewhere on the internet, they reach the real site even when the browser,
// which goes to 127.0.0.1, meets the intercepting server.
import dns from 'node:dns/promises';

const lookup = dns.lookup.bind(dns);
const NAMES = new Set(['www.example.com', 'example.com']);

dns.lookup = (host, options) => {
  if (NAMES.has(String(host).toLowerCase())) {
    const answer = { address: '127.0.0.2', family: 4 };
    return Promise.resolve(options && options.all ? [answer] : answer);
  }
  return lookup(host, options);
};
