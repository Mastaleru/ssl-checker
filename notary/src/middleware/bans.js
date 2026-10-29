// Escalating bans: the notary's brute-force and flood protection.
//
// A strike is a request refused for abuse: over the rate limit, a wrong token, or
// a foreign Origin. A client that collects `strikes` strikes within `windowMs` is
// banned for `firstMs`; every later ban lasts twice as long, up to `maxMs`. A client
// is forgotten once it has been quiet for `maxMs`, so its next ban starts short again.
// Clients are keyed by address, IPv6 by /64 network (see limits.js). State lives in
// memory, capped at `maxClients`: a restart clears it, and no client can cause one.
import { NotaryError } from '../errors.js';

export function createBans({
  strikes,
  windowMs,
  firstMs,
  maxMs,
  alertPerMinute = 300,
  maxClients = 10_000,
  now = Date.now,
  logger,
}) {
  const clients = new Map(); // key → { hits: number[], level, bannedUntil, last }; least recent first
  let minute = -1;
  let strikesThisMinute = 0;

  function touch(key) {
    let client = clients.get(key);
    if (client) {
      clients.delete(key);
    } else {
      client = { hits: [], level: 0, bannedUntil: 0, last: 0 };
    }
    clients.set(key, client);
    if (clients.size > maxClients) {
      clients.delete(clients.keys().next().value);
    }
    return client;
  }

  // One warning a minute when strikes pile up from many clients at once.
  function countForAlert(t) {
    const m = Math.floor(t / 60_000);
    if (m !== minute) {
      minute = m;
      strikesThisMinute = 0;
    }
    strikesThisMinute += 1;
    if (strikesThisMinute === alertPerMinute) {
      logger.warn('abuse alert', { strikesThisMinute, trackedClients: clients.size });
    }
  }

  function strike(key, reason) {
    const t = now();
    countForAlert(t);
    const client = touch(key);
    client.last = t;
    if (client.bannedUntil > t) {
      return;
    }
    client.hits = client.hits.filter((at) => t - at < windowMs);
    client.hits.push(t);
    if (client.hits.length >= strikes) {
      const ms = Math.min(firstMs * 2 ** client.level, maxMs);
      client.level += 1;
      client.bannedUntil = t + ms;
      client.hits = [];
      logger.warn('client banned', { client: key, reason, seconds: Math.round(ms / 1000), ban: client.level });
    }
  }

  function remainingMs(key) {
    const client = clients.get(key);
    return client ? Math.max(0, client.bannedUntil - now()) : 0;
  }

  function sweep() {
    const t = now();
    for (const [key, client] of clients) {
      if (client.bannedUntil <= t && t - client.last >= maxMs) {
        clients.delete(key);
      }
    }
  }

  /** Middleware that answers 429 to banned clients before anything else runs. */
  function guard(keyOf) {
    return function refuseBanned(req, res, next) {
      const ms = remainingMs(keyOf(req));
      if (ms > 0) {
        next(
          new NotaryError(429, 'rateLimited', 'temporarily blocked after repeated abuse', {
            'Retry-After': String(Math.ceil(ms / 1000)),
          }),
        );
        return;
      }
      next();
    };
  }

  return {
    strike,
    remainingMs,
    sweep,
    guard,
    get size() {
      return clients.size;
    },
  };
}
