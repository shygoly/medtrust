import test from 'node:test';
import assert from 'node:assert/strict';
import { isTokenExpiringSoon, tokenExpiryMs } from './token';

const jwt = (payload: Record<string, unknown>): string =>
  [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.');

test('token 过期判断：已过期/将过期/仍有效', () => {
  const now = 1_700_000_000_000;
  assert.equal(isTokenExpiringSoon(jwt({ exp: now / 1000 - 10 }), 90, now), true);
  assert.equal(isTokenExpiringSoon(jwt({ exp: now / 1000 + 30 }), 90, now), true);
  assert.equal(isTokenExpiringSoon(jwt({ exp: now / 1000 + 3600 }), 90, now), false);
});

test('拿不到 exp / 坏 token → 不判断为过期（不能因此反复续签）', () => {
  assert.equal(tokenExpiryMs('not-a-jwt'), null);
  assert.equal(tokenExpiryMs(''), null);
  assert.equal(isTokenExpiringSoon('not-a-jwt'), false);
  assert.equal(isTokenExpiringSoon(jwt({ sub: 'x' })), false);
});
