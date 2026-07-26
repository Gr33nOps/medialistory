/**
 * Stronger HTTP smoke tests with mocked auth/DB dependencies.
 * Does not require a live Postgres or Supabase.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-smoke-secret';
const { getTokenFromRequest, attachAuthCookie, clearAuthCookieHeader } = require('../../Backend/sessionCookies');

let server;
let baseUrl;
const users = new Map();
const follows = new Set();
const games = new Map();

function makeApp() {
  const app = express();
  app.use(express.json());

  const verifyToken = (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.userId;
      next();
    } catch (_) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  app.post('/api/auth/register', (req, res) => {
    const { email, username, password } = req.body || {};
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if ([...users.values()].some((u) => u.email === email || u.username === username)) {
      return res.status(400).json({ error: 'Already registered' });
    }
    const id = 'user-' + users.size;
    users.set(id, { id, email, username, password });
    res.status(201).json({ message: 'Registered', user: { id, email, username } });
  });

  app.post('/api/auth/login', (req, res) => {
    const { emailOrUsername, password, rememberMe } = req.body || {};
    const user = [...users.values()].find(
      (u) => u.email === emailOrUsername || u.username === emailOrUsername
    );
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id, tv: 0 }, JWT_SECRET, { expiresIn: '2h' });
    attachAuthCookie(res, token, !!rememberMe);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearAuthCookieHeader(res);
    res.json({ success: true });
  });

  app.post('/api/user/games', verifyToken, (req, res) => {
    const { igdb_id, status } = req.body || {};
    if (!igdb_id) return res.status(400).json({ error: 'igdb_id required' });
    const key = req.userId + ':' + igdb_id;
    games.set(key, { userId: req.userId, igdb_id, status: status || 'playing' });
    res.status(201).json({ ok: true, game: games.get(key) });
  });

  app.post('/api/follow/:id', verifyToken, (req, res) => {
    const target = req.params.id;
    if (!users.has(target)) return res.status(404).json({ error: 'User not found' });
    if (target === req.userId) return res.status(400).json({ error: 'Cannot follow self' });
    follows.add(req.userId + '>' + target);
    res.json({ ok: true });
  });

  app.get('/api/me', verifyToken, (req, res) => {
    const user = users.get(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ id: user.id, username: user.username });
  });

  return app;
}

function request(method, path, { body, token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch (_) { json = raw; }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            setCookie: res.headers['set-cookie'] || []
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  server = http.createServer(makeApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('register → login sets cookie + bearer token', async () => {
  const reg = await request('POST', '/api/auth/register', {
    body: { email: 'a@example.com', username: 'alice', password: 'secret123' }
  });
  assert.equal(reg.status, 201);

  const login = await request('POST', '/api/auth/login', {
    body: { emailOrUsername: 'alice', password: 'secret123', rememberMe: true }
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  assert.ok(login.setCookie.some((c) => c.includes('mgl_token=')));

  const meBearer = await request('GET', '/api/me', { token: login.body.token });
  assert.equal(meBearer.status, 200);
  assert.equal(meBearer.body.username, 'alice');

  const cookieHeader = login.setCookie[0].split(';')[0];
  const meCookie = await request('GET', '/api/me', { cookie: cookieHeader });
  assert.equal(meCookie.status, 200);
  assert.equal(meCookie.body.username, 'alice');
});

test('add game + follow with mocked auth', async () => {
  const login = await request('POST', '/api/auth/login', {
    body: { emailOrUsername: 'alice', password: 'secret123' }
  });
  const token = login.body.token;

  const bobReg = await request('POST', '/api/auth/register', {
    body: { email: 'b@example.com', username: 'bob', password: 'secret123' }
  });
  assert.equal(bobReg.status, 201);
  const bobId = bobReg.body.user.id;

  const add = await request('POST', '/api/user/games', {
    token,
    body: { igdb_id: 1942, status: 'completed' }
  });
  assert.equal(add.status, 201);
  assert.equal(add.body.game.igdb_id, 1942);

  const follow = await request('POST', '/api/follow/' + bobId, { token });
  assert.equal(follow.status, 200);
  assert.equal(follow.body.ok, true);
});

test('logout clears cookie', async () => {
  const out = await request('POST', '/api/auth/logout');
  assert.equal(out.status, 200);
  assert.ok(out.setCookie.some((c) => /Max-Age=0/i.test(c)));
});
