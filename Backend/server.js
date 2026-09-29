require('./instrument'); // MUST run before express is required (Sentry init)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const knex = require('knex');
const path = require('path');
const { clientError, IS_PROD } = require('./errors');
const { createRedisStore } = require('./rateLimitStore');
const { buildApiRoutes } = require('./routes');

// Legacy Node/Express entry point, kept for rollback. The production API runs
// on Cloudflare Workers (worker/index.js) with the same route modules.
// Do not override platform env. Local `.env` only fills gaps.
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
  override: false
});

// Sentry was initialized in ./instrument (before Express). Grab the same
// instance so we can attach the Express error handler below; null if disabled.
let Sentry = null;
try {
  const S = require('@sentry/node');
  if (S.getClient && S.getClient()) Sentry = S;
} catch (_) {}

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NEON_AUTH_BASE_URL'
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('\nMissing environment variables:\n');
  missing.forEach(k => console.error(`  - ${k}`));
  console.error('\n.env expected at:', path.resolve(__dirname, '..', '.env'), '\n');
  process.exit(1);
}

function parseDatabaseTarget(url) {
  try {
    const normalized = String(url || '').trim().replace(/^postgresql:/i, 'http:');
    const u = new URL(normalized);
    return {
      host: u.hostname,
      user: decodeURIComponent(u.username || ''),
      port: u.port || '5432'
    };
  } catch (_) {
    return null;
  }
}

const dbTarget = parseDatabaseTarget(process.env.DATABASE_URL);
if (dbTarget) {
  console.log(`Database target: ${dbTarget.user}@${dbTarget.host}:${dbTarget.port}`);
}

const app = express();
// A hosting proxy terminates TLS in front of the app. Without this, req.protocol reports
// http, and the absolute avatar URLs built from it would be blocked as mixed
// content on the https frontend.
app.set('trust proxy', 1);
function normalizeFrontendUrl(raw) {
  let url = String(raw || 'http://localhost:3000').trim().replace(/\/$/, '');
  // Browsers send Origin with a scheme; bare hostnames in env break CORS.
  if (url && !/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url;
}
const FRONTEND_URL = normalizeFrontendUrl(process.env.FRONTEND_URL);
const ALLOW_DEGRADED = process.env.ALLOW_DEGRADED === '1';
const DB_SSL_INSECURE = process.env.DB_SSL_INSECURE === '1';
// Origin of the Neon Auth server (for CSP connect-src so the browser can complete OAuth).
let NEON_AUTH_ORIGIN = null;
try { if (process.env.NEON_AUTH_BASE_URL) NEON_AUTH_ORIGIN = new URL(process.env.NEON_AUTH_BASE_URL).origin; } catch (_) {}
let dbReady = false;

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  // Helmet defaults Referrer-Policy to "no-referrer", which strips the Referer
  // header from the YouTube trailer <iframe>. YouTube uses that header to verify
  // the embedding domain and, when it is missing, refuses to play with a
  // "Video player configuration error (153)". Sending just the origin restores
  // playback without leaking full URLs.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://www.googletagmanager.com', 'https://*.sentry-cdn.com'],
      "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      "img-src": ["'self'", 'data:', 'https:'],
      "font-src": ["'self'", 'data:', 'https://fonts.gstatic.com'],
      "connect-src": ["'self'", FRONTEND_URL, NEON_AUTH_ORIGIN, 'https://*.neon.tech', 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.sentry.io'].filter(Boolean),
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-src": ["https://www.youtube-nocookie.com", 'https://www.youtube.com'],
      "frame-ancestors": ["'none'"]
    }
  }
}));

app.use(compression());
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

// Extra browser origins allowed to call the API (comma-separated), e.g. Vercel
// preview deployments. FRONTEND_URL is always allowed on top of these.
const EXTRA_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => normalizeFrontendUrl(s))
  .filter((s) => /^https?:\/\//i.test(s));
// This service still serves the frontend statically as a same-origin fallback
// (see the "/" static handler below), so its own origin must stay allowed
// even when FRONTEND_URL points elsewhere (e.g. the Vercel split).
const BACKEND_ORIGIN = process.env.BACKEND_URL ? normalizeFrontendUrl(process.env.BACKEND_URL) : null;
const ALLOWED_ORIGINS = new Set([FRONTEND_URL, BACKEND_ORIGIN, ...EXTRA_ORIGINS].filter(Boolean));

app.use(cors({
  origin(origin, callback) {
    if (!origin ||
        ALLOWED_ORIGINS.has(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  // The anime grid collapses a franchise into one tile, so a full page of
  // results no longer means "there is more". The server says so outright.
  exposedHeaders: ['X-Has-More', 'X-Sort-State', 'X-Filters-Applied']
}));

app.use(express.json({ limit: '400kb' })); // headroom for uploaded data: URI avatars

// API responses must not be cached - browsers turn GETs into 304s which break fetch().json().
app.set('etag', false);
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const IGDB_WINDOW_MS = 60 * 1000;
const authStore = createRedisStore(AUTH_WINDOW_MS);
const igdbStore = createRedisStore(IGDB_WINDOW_MS);

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later' },
  // Safe read-only endpoints called on normal page loads must not count toward
  // the login/brute-force budget (otherwise navigating hides OAuth buttons etc.).
  skip: (req) => req.method === 'GET' && ['/public-config', '/session', '/me'].includes(req.path),
  ...(authStore ? { store: authStore } : {})
});

const igdbLimiter = rateLimit({
  windowMs: IGDB_WINDOW_MS,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many game data requests, please slow down' },
  ...(igdbStore ? { store: igdbStore } : {})
});

const db = knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: !DB_SSL_INSECURE }
  },
  pool: { min: 2, max: 10 }
});

db.raw('SELECT 1')
  .then(() => {
    dbReady = true;
    console.log('Neon PostgreSQL connected');
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
    if (dbTarget) {
      console.error(`Tried: ${dbTarget.user}@${dbTarget.host}:${dbTarget.port}`);
    }
    if (ALLOW_DEGRADED) {
      console.warn('ALLOW_DEGRADED=1 - continuing without DB (auth/lists will fail).');
      return;
    }
    console.error('Exiting: database is required. Set ALLOW_DEGRADED=1 only for local IGDB-only checks.');
    process.exit(1);
  });

const JWT_SECRET = process.env.JWT_SECRET;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/ready', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    dbReady = true;
    const igdbConfigured = !!(
      process.env.IGDB_CLIENT_ID &&
      (process.env.IGDB_CLIENT_SECRET || process.env.IGDB_ACCESS_TOKEN)
    );
    res.json({
      status: 'ready',
      db: true,
      igdb: igdbConfigured,
      rateLimitStore: authStore || igdbStore ? 'redis' : 'memory'
    });
  } catch (error) {
    dbReady = false;
    res.status(503).json({ status: 'not_ready', db: false });
  }
});

console.log('Loading routes...');

try {
  const { mounts } = buildApiRoutes({
    db,
    jwtSecret: JWT_SECRET,
    limiters: { auth: authLimiter, catalog: igdbLimiter }
  });
  for (const [prefix, ...handlers] of mounts) app.use(prefix, ...handlers);
} catch (error) {
  console.error('  Error loading routes:', error.message);
  process.exit(1);
}

console.log('All routes loaded\n');

const frontendPath = path.join(__dirname, '..', 'Frontend');
app.use(express.static(frontendPath, {
  etag: false,
  lastModified: true,
  maxAge: 0,
  index: false, // '/' is routed to the dashboard below, not the static index.html
  setHeaders(res, filePath) {
    const name = path.basename(filePath).toLowerCase();
    // Avoid stale JS/HTML during local iteration (was causing old home.js + API 304 bugs).
    if (/\.(?:js|css|html?)$/i.test(name)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(name)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

app.get('/', (req, res) => res.sendFile(path.join(frontendPath, 'dashboard.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(frontendPath, 'dashboard.html')));
app.get('/auth.html', (req, res) => res.sendFile(path.join(frontendPath, 'auth.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(frontendPath, 'home.html')));
app.get('/movies.html', (req, res) => res.sendFile(path.join(frontendPath, 'movies.html')));
app.get('/series.html', (req, res) => res.sendFile(path.join(frontendPath, 'series.html')));
app.get('/anime.html', (req, res) => res.sendFile(path.join(frontendPath, 'anime.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(frontendPath, 'profile.html')));
app.get('/library.html', (req, res) => res.sendFile(path.join(frontendPath, 'library.html')));
app.get('/friends.html', (req, res) => res.sendFile(path.join(frontendPath, 'friends.html')));
app.get('/userProfile.html', (req, res) => res.sendFile(path.join(frontendPath, 'userProfile.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(frontendPath, 'terms.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(frontendPath, 'privacy.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(frontendPath, 'dashboard.html')));
app.get('/title.html', (req, res) => res.sendFile(path.join(frontendPath, 'title.html')));
app.get('/person.html', (req, res) => res.sendFile(path.join(frontendPath, 'person.html')));
app.get('/about.html', (req, res) => res.sendFile(path.join(frontendPath, 'about.html')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(frontendPath, 'robots.txt')));

// Sentry error handler must sit after routes and before our own error handler.
if (Sentry && typeof Sentry.setupExpressErrorHandler === 'function') {
  Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS blocked' });
  }
  return clientError(res, 500, 'Something went wrong!', err);
});

app.use((req, res) => {
  const accept = String(req.headers.accept || '');
  if (req.method === 'GET' && accept.includes('text/html')) {
    return res.status(404).sendFile(path.join(frontendPath, '404.html'));
  }
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});