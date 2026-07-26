const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  COOKIE_NAME,
  parseCookies,
  getTokenFromRequest,
  attachAuthCookie,
  clearAuthCookieHeader
} = require('../../Backend/sessionCookies');

test('parseCookies reads mgl_token', () => {
  const cookies = parseCookies({
    headers: { cookie: 'a=1; mgl_token=abc%2Edef; b=2' }
  });
  assert.equal(cookies.mgl_token, 'abc.def');
});

test('getTokenFromRequest prefers Bearer over cookie', () => {
  const token = getTokenFromRequest({
    headers: {
      authorization: 'Bearer bearer-token',
      cookie: `${COOKIE_NAME}=cookie-token`
    }
  });
  assert.equal(token, 'bearer-token');
});

test('getTokenFromRequest falls back to cookie', () => {
  const token = getTokenFromRequest({
    headers: { cookie: `${COOKIE_NAME}=cookie-only` }
  });
  assert.equal(token, 'cookie-only');
});

test('attachAuthCookie sets HttpOnly SameSite cookie', () => {
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    }
  };
  // rememberMe=true: 30 days
  attachAuthCookie(res, 'tok.en', true);
  assert.match(headers['Set-Cookie'], new RegExp(`^${COOKIE_NAME}=`));
  assert.match(headers['Set-Cookie'], /HttpOnly/);
  assert.match(headers['Set-Cookie'], /SameSite=Lax/);
  assert.match(headers['Set-Cookie'], /Max-Age=2592000/);

  // default session: 7 days
  attachAuthCookie(res, 'tok.en', false);
  assert.match(headers['Set-Cookie'], /Max-Age=604800/);
});

test('clearAuthCookieHeader expires cookie', () => {
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    }
  };
  clearAuthCookieHeader(res);
  assert.match(headers['Set-Cookie'], /Max-Age=0/);
});
