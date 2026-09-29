/* The app's own session token: HS256, payload { userId, tv }, signed with
   JWT_SECRET. Built on jose (Web Crypto) so it runs on Node and on Workers.

   The output is interchangeable with the jsonwebtoken tokens this replaced
   (same algorithm, same `typ` header, `iat`/`exp` in seconds), so a session
   issued by one backend is accepted by the other during the cutover. */

const { SignJWT, jwtVerify } = require('jose');

const encoder = new TextEncoder();
const keys = new Map();

function keyFor(secret) {
  if (!secret) throw new Error('JWT secret is not configured');
  let key = keys.get(secret);
  if (!key) {
    key = encoder.encode(secret);
    keys.set(secret, key);
  }
  return key;
}

// jsonwebtoken-style durations: '7d', '30d', '2h', '15m', '45s' or seconds.
function toSeconds(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn;
  const m = /^(\d+)\s*([dhms])$/.exec(String(expiresIn || '').trim());
  if (!m) throw new Error(`Unsupported expiresIn: ${expiresIn}`);
  const unit = { d: 86400, h: 3600, m: 60, s: 1 }[m[2]];
  return Number(m[1]) * unit;
}

async function sign(payload, secret, { expiresIn } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now);
  if (expiresIn != null) jwt.setExpirationTime(now + toSeconds(expiresIn));
  return jwt.sign(keyFor(secret));
}

/** Resolves to the payload, or rejects for a bad signature, algorithm or expiry. */
async function verify(token, secret) {
  const { payload } = await jwtVerify(String(token || ''), keyFor(secret), {
    algorithms: ['HS256']
  });
  return payload;
}

module.exports = { sign, verify };
