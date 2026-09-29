/* The Worker's request/response objects must look like Express's to the
   route modules. worker/http.js has no Workers-only imports, so it runs here. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequest, createResponse, readJsonBody, JSON_BODY_LIMIT } = require('../../worker/http');

function jsonRequest(body, headers = {}) {
  return new Request('https://api.example/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ...headers },
    body
  });
}

test('request exposes Express-style members', () => {
  const url = new URL('https://api.example/api/user/export?category=movie&tag=a&tag=b');
  const raw = new Request(url, { headers: { Authorization: 'Bearer t', 'CF-Connecting-IP': '203.0.113.9' } });
  const req = createRequest(raw, url, undefined);
  assert.equal(req.method, 'GET');
  assert.equal(req.path, '/api/user/export');
  assert.deepEqual({ ...req.query }, { category: 'movie', tag: ['a', 'b'] });
  assert.equal(Object.getPrototypeOf(req.query), null);
  assert.equal(req.headers.authorization, 'Bearer t');
  assert.equal(req.get('Host'), 'api.example');
  assert.equal(req.protocol, 'https');
  assert.equal(req.ip, '203.0.113.9');
});

test('hostile header and query names cannot reach Object.prototype', () => {
  const url = new URL('https://api.example/api/x?__proto__=polluted&constructor=x');
  const raw = new Request(url);
  raw.headers.set('__proto__', 'polluted');
  const req = createRequest(raw, url, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(req.query.__proto__, 'polluted');
  assert.equal(Object.getPrototypeOf(req.headers), Object.prototype);
});

test('JSON bodies parse like express.json()', async () => {
  assert.deepEqual(await readJsonBody(jsonRequest('{"a":1}')), { a: 1 });
  assert.deepEqual(await readJsonBody(jsonRequest('')), {});
  assert.equal(await readJsonBody(new Request('https://api.example/', { method: 'POST', body: 'x' })), undefined);
  await assert.rejects(readJsonBody(jsonRequest('{"a":')), (e) => e.status === 400);
  await assert.rejects(readJsonBody(jsonRequest('"a string"')), (e) => e.status === 400);
  await assert.rejects(readJsonBody(jsonRequest('{"a":"' + 'x'.repeat(JSON_BODY_LIMIT) + '"}')), (e) => e.status === 413);
});

test('res.json sets status, type and body; finish listeners fire', async () => {
  const res = createResponse('POST');
  let finished = false;
  res.on('finish', () => { finished = res.statusCode; });
  res.status(201).json({ ok: true });
  const response = await res.done;
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(finished, 201);
});

test('multiple Set-Cookie values and redirects survive', async () => {
  const res = createResponse('GET');
  res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
  res.redirect('https://medialistory.vercel.app/auth.html?oauth=done');
  const response = await res.done;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://medialistory.vercel.app/auth.html?oauth=done');
  assert.deepEqual(response.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
});

test('binary bodies, 304 and HEAD', async () => {
  const img = createResponse('GET');
  img.set({ 'Content-Type': 'image/png' });
  img.end(Buffer.from([1, 2, 3]));
  assert.deepEqual([...new Uint8Array(await (await img.done).arrayBuffer())], [1, 2, 3]);

  const notModified = createResponse('GET');
  notModified.status(304).end();
  assert.equal((await notModified.done).body, null);

  const head = createResponse('HEAD');
  head.json({ big: true });
  assert.equal((await head.done).body, null);
});

test('only the first end() counts', async () => {
  const res = createResponse('GET');
  res.json({ first: true });
  res.status(500).json({ second: true });
  const response = await res.done;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { first: true });
});
