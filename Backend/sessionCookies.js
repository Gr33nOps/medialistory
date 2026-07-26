/** HttpOnly session cookie helpers (dual-auth with Bearer JWT). */

const COOKIE_NAME = 'mgl_token';

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch (_) {
      out[key] = val;
    }
  });
  return out;
}

function getTokenFromRequest(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';
  if (bearer) return bearer;
  return parseCookies(req)[COOKIE_NAME] || '';
}

function buildSetCookie(token, rememberMe) {
  const maxAgeSec = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function clearAuthCookie() {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function attachAuthCookie(res, token, rememberMe) {
  res.setHeader('Set-Cookie', buildSetCookie(token, rememberMe));
}

function clearAuthCookieHeader(res) {
  res.setHeader('Set-Cookie', clearAuthCookie());
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  getTokenFromRequest,
  attachAuthCookie,
  clearAuthCookieHeader
};
