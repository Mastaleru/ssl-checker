import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBans } from '../src/middleware/bans.js';
import { memoryLogger } from './helpers.js';

const MIN = 60_000;

function setup(overrides = {}) {
  let t = 1_000_000;
  const logger = memoryLogger();
  const bans = createBans({
    strikes: 3,
    windowMs: 10 * MIN,
    firstMs: MIN,
    maxMs: 8 * MIN,
    now: () => t,
    logger,
    ...overrides,
  });
  return { bans, logger, advance: (ms) => (t += ms) };
}

test('a client is banned after enough strikes inside the window', () => {
  const { bans, logger, advance } = setup();
  bans.strike('a', 'rate');
  bans.strike('a', 'rate');
  assert.equal(bans.remainingMs('a'), 0);
  bans.strike('a', 'rate');
  assert.equal(bans.remainingMs('a'), MIN);
  assert.equal(logger.lines.at(-1).msg, 'client banned');
  assert.equal(logger.lines.at(-1).seconds, 60);
  advance(30_000);
  assert.equal(bans.remainingMs('a'), 30_000);
  assert.equal(bans.remainingMs('b'), 0, 'other clients are not affected');
});

test('strikes older than the window do not count', () => {
  const { bans, advance } = setup();
  bans.strike('a');
  bans.strike('a');
  advance(11 * MIN);
  bans.strike('a');
  assert.equal(bans.remainingMs('a'), 0);
});

test('each new ban lasts twice as long, up to the maximum', () => {
  const { bans, advance } = setup();
  const lengths = [];
  for (let round = 0; round < 6; round++) {
    bans.strike('a');
    bans.strike('a');
    bans.strike('a');
    const ms = bans.remainingMs('a');
    lengths.push(ms / MIN);
    advance(ms);
  }
  assert.deepEqual(lengths, [1, 2, 4, 8, 8, 8]);
});

test('strikes during a ban do not extend it', () => {
  const { bans } = setup();
  for (let i = 0; i < 10; i++) {
    bans.strike('a');
  }
  assert.equal(bans.remainingMs('a'), MIN);
});

test('a quiet client is forgotten, so its next ban starts short again', () => {
  const { bans, advance } = setup();
  for (let i = 0; i < 6; i++) {
    bans.strike('a');
  }
  advance(MIN);
  bans.sweep();
  assert.equal(bans.size, 1, 'still remembered right after the ban');
  advance(8 * MIN);
  bans.sweep();
  assert.equal(bans.size, 0);
  bans.strike('a');
  bans.strike('a');
  bans.strike('a');
  assert.equal(bans.remainingMs('a'), MIN);
});

test('memory stays bounded and the alert fires once a minute', () => {
  const { bans, logger } = setup({ maxClients: 100, alertPerMinute: 50 });
  for (let i = 0; i < 1000; i++) {
    bans.strike(`client-${i}`);
  }
  assert.equal(bans.size, 100);
  assert.equal(logger.lines.filter((l) => l.msg === 'abuse alert').length, 1);
});

test('the guard answers 429 with Retry-After to banned clients', () => {
  const { bans } = setup();
  const guard = bans.guard((req) => req.key);
  let error = 'not called';
  guard({ key: 'a' }, {}, (e) => (error = e));
  assert.equal(error, undefined);
  bans.strike('a');
  bans.strike('a');
  bans.strike('a');
  guard({ key: 'a' }, {}, (e) => (error = e));
  assert.equal(error.status, 429);
  assert.equal(error.code, 'rateLimited');
  assert.equal(error.headers['Retry-After'], '60');
});
