/* The Express-compatible router the route modules now build on. Each case is
   something a route module depends on; they run on plain objects, the same
   shape both Express and the Worker hand in. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Router } = require('../../Backend/http/router');

function fakeReq(method, url) {
  return { method, url, baseUrl: '', params: {}, headers: {} };
}
function fakeRes() {
  const res = { statusCode: 200, headersSent: false, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}
function run(router, method, url) {
  return new Promise((resolve) => {
    const req = fakeReq(method, url);
    const res = fakeRes();
    const origJson = res.json;
    res.json = (b) => { origJson(b); resolve({ req, res, fellThrough: false }); return res; };
    router(req, res, (err) => resolve({ req, res, err, fellThrough: true }));
  });
}

test('matches params, decodes them, and ignores a trailing slash and case', async () => {
  const r = Router();
  r.get('/lists/:listId/games/:gameId', (req, res) => res.json(req.params));
  const { res } = await run(r, 'GET', '/Lists/7/games/igdb%5F1942/');
  assert.deepEqual(res.body, { listId: '7', gameId: 'igdb_1942' });
});

test('method must match, and HEAD is answered by GET routes', async () => {
  const r = Router();
  r.get('/x', (req, res) => res.json({ ok: true }));
  assert.equal((await run(r, 'POST', '/x')).fellThrough, true);
  assert.deepEqual((await run(r, 'HEAD', '/x')).res.body, { ok: true });
});

test('nested routers see the path below their mount; later layers see it restored', async () => {
  const inner = Router();
  inner.get('/me', (req, res) => res.json({ url: req.url, base: req.baseUrl }));
  const outer = Router();
  outer.use('/api/auth', inner);
  outer.get('/api/auth/other', (req, res) => res.json({ url: req.url, base: req.baseUrl }));

  const { res } = await run(outer, 'GET', '/api/auth/me?x=1');
  assert.deepEqual(res.body, { url: '/me?x=1', base: '/api/auth' });

  const fell = await run(outer, 'GET', '/api/auth/other?y=2');
  assert.deepEqual(fell.res.body, { url: '/api/auth/other?y=2', base: '' });
});

test('a mount prefix only matches whole segments', async () => {
  const inner = Router();
  inner.get('/', (req, res) => res.json({ hit: true }));
  const outer = Router();
  outer.use('/api/user', inner);
  assert.equal((await run(outer, 'GET', '/api/users')).fellThrough, true);
});

test('requests fall through routers that share a prefix, in registration order', async () => {
  const profile = Router();
  profile.get('/profile', (req, res) => res.json({ from: 'profile' }));
  const library = Router();
  library.get('/games', (req, res) => res.json({ from: 'library' }));
  const app = Router();
  app.use('/api/user', profile);
  app.use('/api/user', library);
  assert.deepEqual((await run(app, 'GET', '/api/user/games')).res.body, { from: 'library' });
  assert.deepEqual((await run(app, 'GET', '/api/user/profile')).res.body, { from: 'profile' });
});

test('router.use middleware runs before routes and can end the request', async () => {
  const r = Router();
  r.use((req, res, next) => (req.headers.authorization ? next() : res.status(401).json({ error: 'Unauthorized' })));
  r.get('/games', (req, res) => res.json({ ok: true }));
  const { res } = await run(r, 'GET', '/games');
  assert.equal(res.statusCode, 401);
});

test('an async handler that rejects is passed on as an error', async () => {
  const r = Router();
  r.get('/boom', async () => { throw new Error('kaboom'); });
  const { err } = await run(r, 'GET', '/boom');
  assert.equal(err.message, 'kaboom');
});

test('an error skips the remaining handlers', async () => {
  const r = Router();
  let reached = false;
  r.get('/x', (req, res, next) => next(new Error('stop')), () => { reached = true; });
  const { err } = await run(r, 'GET', '/x');
  assert.equal(err.message, 'stop');
  assert.equal(reached, false);
});

test('Express can mount a Router as ordinary middleware', async () => {
  const express = require('express');
  const http = require('http');
  const r = Router();
  r.get('/ping/:n', (req, res) => res.json({ n: req.params.n, q: req.query.q }));
  const app = express();
  app.use('/api', r);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/ping/3?q=a`);
    assert.deepEqual(await res.json(), { n: '3', q: 'a' });
  } finally {
    server.close();
  }
});
