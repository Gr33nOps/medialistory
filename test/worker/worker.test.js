/* The Worker, run for real on local workerd through `wrangler dev`.

   No database and no upstream credentials: Hyperdrive points at a closed
   local port and only test secrets are set. That covers everything the Worker
   adds on top of the shared route modules - probes, CORS, security headers,
   body parsing, error shapes, auth failures, both rate limiters and the
   redirect for stray browser visits - without touching Neon or any API.
   Database-backed routes are exercised against staging by
   scripts/worker-smoke.mjs. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jsonwebtoken = require('jsonwebtoken');

const root = path.resolve(__dirname, '..', '..');
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'worker-test-secret';
const FRONTEND = 'https://medialistory.vercel.app';

let child;
let tmp;
let log = '';

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgl-worker-'));
  const devVars = path.join(tmp, 'test.dev.vars');
  fs.writeFileSync(devVars, [
    `JWT_SECRET="${SECRET}"`,
    'NEON_AUTH_BASE_URL="https://auth.invalid/neondb/auth"',
    'NODE_ENV="production"',
    `FRONTEND_URL="${FRONTEND}"`,
    'ALLOWED_ORIGINS="https://preview.example.app"'
  ].join('\n'));

  child = spawn(process.execPath, [
    path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev', '--env=', '--port', String(PORT), '--env-file', devVars,
    '--persist-to', path.join(tmp, 'state'), '--show-interactive-dev-session=false'
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: 'postgres://nobody:nothing@127.0.0.1:9/none'
    }
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  for (let i = 0; i < 240 && !/Ready on/.test(log); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!/Ready on/.test(log)) throw new Error('wrangler dev did not start:\n' + log.slice(-2000));
});

after(() => {
  if (child) child.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

async function call(method, p, { body, headers = {} } = {}) {
  const res = await fetch(BASE + p, {
    method,
    redirect: 'manual',
    headers: body != null ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, text, json };
}

test('/health answers without the database', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.ok(r.json.uptime >= 0 && r.json.uptime < 3600);
});

test('/ready reports the database as down with 503', async () => {
  const r = await call('GET', '/ready');
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { status: 'not_ready', db: false });
});

test('API responses carry no-store and the security headers', async () => {
  const r = await call('GET', '/api/auth/public-config');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { providers: [] });
  assert.equal(r.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
});

test('CORS: production and configured origins allowed, others refused', async () => {
  const ok = await call('GET', '/api/auth/public-config', { headers: { Origin: FRONTEND } });
  assert.equal(ok.headers.get('access-control-allow-origin'), FRONTEND);
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(ok.headers.get('access-control-expose-headers'), 'X-Has-More, X-Sort-State, X-Filters-Applied');

  const preview = await call('GET', '/api/auth/public-config', { headers: { Origin: 'https://preview.example.app' } });
  assert.equal(preview.headers.get('access-control-allow-origin'), 'https://preview.example.app');

  const evil = await call('GET', '/api/auth/public-config', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.deepEqual(evil.json, { error: 'CORS blocked' });

  // Production config: localhost is not an allowed origin.
  const local = await call('GET', '/api/auth/public-config', { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(local.status, 403);
});

test('CORS preflight', async () => {
  const r = await call('OPTIONS', '/api/user/games', {
    headers: { Origin: FRONTEND, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), FRONTEND);
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET,HEAD,PUT,PATCH,POST,DELETE');
  assert.equal(r.headers.get('access-control-allow-headers'), 'authorization,content-type');
});

test('protected routes reject missing and forged tokens', async () => {
  const none = await call('GET', '/api/user/games');
  assert.equal(none.status, 401);
  assert.deepEqual(none.json, { error: 'Unauthorized' });

  const forged = jsonwebtoken.sign({ userId: 'u', tv: 0 }, 'not-the-secret');
  const bad = await call('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.json, { error: 'Invalid token' });

  const cookie = await call('GET', '/api/auth/me', { headers: { Cookie: `mgl_token=${forged}` } });
  assert.equal(cookie.status, 401);
});

test('a valid token reaches the handler (the database is down, so it fails cleanly)', async () => {
  const token = jsonwebtoken.sign({ userId: '00000000-0000-4000-8000-000000000001', tv: 0 }, SECRET, { expiresIn: '5m' });
  const r = await call('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'Server error' });
});

test('bodies: malformed JSON is 400, oversize is 413', async () => {
  const bad = await call('POST', '/api/auth/oauth/exchange', { body: '{"code":' });
  assert.equal(bad.status, 400);
  const big = await call('POST', '/api/auth/oauth/exchange', { body: { code: 'x'.repeat(420 * 1024) } });
  assert.equal(big.status, 413);
});

test('an unknown OAuth hand-off code is refused', async () => {
  const r = await call('POST', '/api/auth/oauth/exchange', { body: { code: 'a'.repeat(64) } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'This sign-in link has expired. Please try again.' });
});

test('unknown API routes are JSON 404s; browser visits go to the frontend', async () => {
  const api = await call('GET', '/api/nope');
  assert.equal(api.status, 404);
  assert.deepEqual(api.json, { error: 'Route not found' });

  const page = await call('GET', '/library.html?x=1', { headers: { Accept: 'text/html' } });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `${FRONTEND}/library.html?x=1`);
});

test('auth rate limit: 40 per window, then 429 with Retry-After', async () => {
  const ip = { 'CF-Connecting-IP': '198.51.100.40' };
  // GET /public-config does not count toward the budget.
  for (let i = 0; i < 5; i++) assert.equal((await call('GET', '/api/auth/public-config', { headers: ip })).status, 200);
  let firstLimited = 0;
  for (let i = 1; i <= 41; i++) {
    const r = await call('POST', '/api/auth/verify-email', { body: {}, headers: ip });
    if (r.status === 429) {
      firstLimited = i;
      assert.deepEqual(r.json, { error: 'Too many auth requests, please try again later' });
      assert.ok(Number(r.headers.get('retry-after')) > 0);
      break;
    }
    assert.equal(r.headers.get('ratelimit-limit'), '40');
  }
  assert.equal(firstLimited, 41);
});

test('catalog rate limit: 60 per minute, then 429', async () => {
  const ip = { 'CF-Connecting-IP': '198.51.100.60' };
  // The binding counts in fixed windows aligned to the minute. If the run
  // straddles a boundary the count restarts, so the first 429 can come at any
  // request from 61 to 121 - but never before 61.
  let firstLimited = 0;
  for (let i = 1; i <= 121; i++) {
    // No IGDB credentials: each call fails fast upstream but still counts.
    const r = await call('POST', '/api/igdb/genres', { body: {}, headers: ip });
    if (r.status === 429) {
      firstLimited = i;
      assert.deepEqual(r.json, { error: 'Too many game data requests, please slow down' });
      assert.equal(r.headers.get('retry-after'), '60');
      break;
    }
  }
  assert.ok(firstLimited >= 61 && firstLimited <= 121, `first 429 at request ${firstLimited}`);
});
