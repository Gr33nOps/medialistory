/* Sessions must survive the move between backends: a token issued by the
   legacy Node server (jsonwebtoken) has to verify on the Worker (jose) and the
   other way round. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jsonwebtoken = require('jsonwebtoken');
const appJwt = require('../../Backend/appJwt');

const SECRET = 'test-secret-for-app-jwt';

test('a jsonwebtoken-issued session verifies with appJwt', async () => {
  const token = jsonwebtoken.sign({ userId: 'u-1', tv: 3 }, SECRET, { expiresIn: '7d' });
  const payload = await appJwt.verify(token, SECRET);
  assert.equal(payload.userId, 'u-1');
  assert.equal(payload.tv, 3);
});

test('an appJwt-issued session verifies with jsonwebtoken, with the same lifetime', async () => {
  const token = await appJwt.sign({ userId: 'u-2', tv: 0 }, SECRET, { expiresIn: '30d' });
  const payload = jsonwebtoken.verify(token, SECRET);
  assert.equal(payload.userId, 'u-2');
  assert.equal(payload.exp - payload.iat, 30 * 24 * 60 * 60);
  assert.deepEqual(jsonwebtoken.decode(token, { complete: true }).header, { alg: 'HS256', typ: 'JWT' });
});

test('wrong secret, expired token and alg=none are all rejected', async () => {
  await assert.rejects(appJwt.verify(jsonwebtoken.sign({ userId: 'x' }, 'other'), SECRET));
  const expired = jsonwebtoken.sign({ userId: 'x', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  await assert.rejects(appJwt.verify(expired, SECRET));
  const none = jsonwebtoken.sign({ userId: 'x' }, null, { algorithm: 'none' });
  await assert.rejects(appJwt.verify(none, SECRET));
});
