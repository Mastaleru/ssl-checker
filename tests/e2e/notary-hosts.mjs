// Loaded into the test notaries with --import. They resolve the test site's names to
// E2E_SITE_ADDRESS:
//   127.0.0.2 (the default), where only the real server answers, on every port the tests
//             use: like a notary elsewhere on the internet, they reach the real site even
//             when the browser, which goes to 127.0.0.1, meets the intercepting server;
//   127.0.0.1, like a notary inside the user's network, which meets what the browser meets.
// The tests cannot listen on port 443, where the notaries look for the HTTPS side of a
// plain HTTP page: E2E_PORT_443 is the port that stands in for it at that address.
import dns from 'node:dns/promises';
import tls from 'node:tls';

const ADDRESS = process.env.E2E_SITE_ADDRESS || '127.0.0.2';
const PORT_443 = Number(process.env.E2E_PORT_443) || 0;
const NAMES = new Set(['www.example.com', 'example.com']);

const lookup = dns.lookup.bind(dns);
dns.lookup = (host, options) => {
  if (NAMES.has(String(host).toLowerCase())) {
    const answer = { address: ADDRESS, family: 4 };
    return Promise.resolve(options && options.all ? [answer] : answer);
  }
  return lookup(host, options);
};

const connect = tls.connect.bind(tls);
tls.connect = (options, ...rest) => {
  if (PORT_443 && options && options.host === ADDRESS && options.port === 443) {
    return connect({ ...options, port: PORT_443 }, ...rest);
  }
  return connect(options, ...rest);
};
