/* MediaListory API on Cloudflare Workers.

   Replaces the Express server in Backend/server.js. The route modules in
   Backend/ are shared with that server; this file supplies what Express and
   its middleware used to: CORS, security headers, rate limits, JSON body
   parsing, the health probes, error handling and access logging.
   See docs/cloudflare-migration.md for the full mapping. */

import * as Sentry from '@sentry/cloudflare';
import { buildApiRoutes } from '../Backend/routes.js';
import { Router } from '../Backend/http/router.js';
import { runWithContext } from '../Backend/runtime.js';
import { OAUTH_CODE_TTL_MS } from '../Backend/auth.js';
import { createRequest, createResponse, readJsonBody } from './http.js';
import { createDbProxy } from './db.js';
import { StateStore, createOauthCodeStore, createIgdbTokenStore, hitAuthLimit } from './stateStore.js';

export { StateStore };

// Set on the first request: the clock does not advance at global scope on Workers.
let bootedAt = 0;

// The Express app's exact limits and messages.
const AUTH_LIMIT = { limit: 40, windowMs: 15 * 60 * 1000 };
const AUTH_LIMIT_SKIP = new Set(['/public-config', '/session', '/me']);
const CATALOG_LIMIT = { limit: 60, windowSec: 60 }; // enforced by the CATALOG_RATE_LIMITER binding

const EXPOSED_HEADERS = 'X-Has-More, X-Sort-State, X-Filters-Applied';

// helmet's defaults, as the Express app sent them, with a CSP suited to an
// API that only ever returns JSON, images and redirects.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0'
};

function normalizeOrigin(raw) {
  let url = String(raw || '').trim().replace(/\/$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function readConfig(env) {
  const frontendUrl = normalizeOrigin(env.FRONTEND_URL) || 'http://localhost:8787';
  const allowed = new Set([frontendUrl, normalizeOrigin(env.BACKEND_URL)]);
  String(env.ALLOWED_ORIGINS || '').split(',').map(normalizeOrigin)
    .filter((o) => /^https?:\/\//i.test(o))
    .forEach((o) => allowed.add(o));
  allowed.delete('');
  return {
    frontendUrl,
    allowedOrigins: allowed,
    // Localhost origins are for local development only; production is strict.
    allowLocalhost: env.NODE_ENV !== 'production',
    isProd: env.NODE_ENV === 'production'
  };
}

function originAllowed(config, origin) {
  if (!origin) return true; // same-origin navigations, curl, server-to-server
  if (config.allowedOrigins.has(origin)) return true;
  return config.allowLocalhost && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const headers = { Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Expose-Headers'] = EXPOSED_HEADERS;
  }
  return headers;
}

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extraHeaders }
  });
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || '';
}

/* ── Rate limits ──────────────────────────────────────────────────────────
   Auth: exactly the Express limit (40 per 15 minutes per IP) held in a
   Durable Object, because a login brute-force budget has to be global.
   Catalog: Cloudflare's Rate Limiting binding (60 per minute per IP). It is
   counted per Cloudflare location, which is fine for a courtesy limit that
   protects the upstream API quotas. If either backend is unavailable the
   request is let through: a limiter outage must not take the API down. */

function authLimiter(env) {
  return async (req, res, next) => {
    if (req.method === 'GET' && AUTH_LIMIT_SKIP.has(req.path)) return next();
    let state;
    try {
      state = await hitAuthLimit(env, req.ip, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
    } catch (err) {
      console.error('Auth rate limiter unavailable:', err && err.message);
      return next();
    }
    const resetSec = Math.max(0, Math.ceil((state.resetAt - Date.now()) / 1000));
    res.setHeader('RateLimit-Policy', `${state.limit};w=${AUTH_LIMIT.windowMs / 1000}`);
    res.setHeader('RateLimit-Limit', String(state.limit));
    res.setHeader('RateLimit-Remaining', String(state.remaining));
    res.setHeader('RateLimit-Reset', String(resetSec));
    if (!state.allowed) {
      res.setHeader('Retry-After', String(resetSec));
      return res.status(429).json({ error: 'Too many auth requests, please try again later' });
    }
    return next();
  };
}

function catalogLimiter(env) {
  return async (req, res, next) => {
    if (!env.CATALOG_RATE_LIMITER) return next();
    let outcome;
    try {
      outcome = await env.CATALOG_RATE_LIMITER.limit({ key: req.ip || 'unknown' });
    } catch (err) {
      console.error('Catalog rate limiter unavailable:', err && err.message);
      return next();
    }
    res.setHeader('RateLimit-Policy', `${CATALOG_LIMIT.limit};w=${CATALOG_LIMIT.windowSec}`);
    res.setHeader('RateLimit-Limit', String(CATALOG_LIMIT.limit));
    if (!outcome.success) {
      res.setHeader('Retry-After', String(CATALOG_LIMIT.windowSec));
      return res.status(429).json({ error: 'Too many game data requests, please slow down' });
    }
    return next();
  };
}

/* ── App ──────────────────────────────────────────────────────────────── */

let app = null;

function buildApp(env) {
  const router = Router();
  const { mounts } = buildApiRoutes({
    db: createDbProxy(),
    jwtSecret: env.JWT_SECRET,
    limiters: { auth: authLimiter(env), catalog: catalogLimiter(env) },
    oauthCodes: createOauthCodeStore(env, OAUTH_CODE_TTL_MS),
    igdbTokenStore: createIgdbTokenStore(env),
    warmCatalog: false
  });
  for (const [prefix, ...handlers] of mounts) router.use(prefix, ...handlers);
  return router;
}

function missingConfig(env) {
  const missing = [];
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.NEON_AUTH_BASE_URL) missing.push('NEON_AUTH_BASE_URL');
  if (!env.HYPERDRIVE) missing.push('HYPERDRIVE');
  if (!env.STATE_STORE) missing.push('STATE_STORE');
  return missing;
}

// Background work (write-through caching, and the tail of any handler that
// keeps running after it answered) must finish before the connection closes.
async function drain(context) {
  while (context.pending.length) {
    await Promise.allSettled(context.pending.splice(0));
  }
  if (context.knex) {
    const knex = context.knex;
    context.knex = null;
    await knex.destroy().catch(() => {});
  }
}

function health() {
  return jsonResponse(200, { status: 'ok', uptime: (Date.now() - bootedAt) / 1000 });
}

async function ready(env) {
  try {
    await createDbProxy().raw('SELECT 1');
    const igdbConfigured = !!(env.IGDB_CLIENT_ID && (env.IGDB_CLIENT_SECRET || env.IGDB_ACCESS_TOKEN));
    return jsonResponse(200, { status: 'ready', db: true, igdb: igdbConfigured, rateLimitStore: 'cloudflare' });
  } catch (err) {
    console.error('Readiness check failed:', err && err.message);
    return jsonResponse(503, { status: 'not_ready', db: false });
  }
}

async function dispatchApi(request, url, config, cors) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return jsonResponse(err.status || 400, { error: err.expose ? err.message : 'Invalid request body' }, cors);
  }

  const req = createRequest(request, url, body);
  const res = createResponse(req.method);
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...cors })) res.setHeader(name, value);
  // API responses must not be cached (browsers turn GETs into 304s that break fetch().json()).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  app.handle(req, res, (err) => {
    if (res.headersSent) {
      if (err) console.error('Error after response was sent:', err && err.message);
      return;
    }
    if (err) {
      console.error('Unhandled route error:', err && (err.stack || err.message));
      Sentry.captureException(err);
      const payload = { error: 'Something went wrong!' };
      if (!config.isProd) payload.message = err.message || String(err);
      res.status(500).json(payload);
      return;
    }
    res.status(404).json({ error: 'Route not found' });
  });
  return res.done;
}

async function handle(request, env, ctx) {
  if (!bootedAt) bootedAt = Date.now();
  const url = new URL(request.url);
  const config = readConfig(env);
  const origin = request.headers.get('origin');

  // A disallowed origin is refused outright, as the Express cors() setup did.
  if (!originAllowed(config, origin)) {
    return jsonResponse(403, { error: 'CORS blocked' });
  }
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    const requested = request.headers.get('access-control-request-headers');
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        ...cors,
        'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
        ...(requested ? { 'Access-Control-Allow-Headers': requested, Vary: 'Origin, Access-Control-Request-Headers' } : {}),
        'Access-Control-Max-Age': '600',
        'Content-Length': '0'
      }
    });
  }

  if (url.pathname === '/health') return withHeaders(health(), cors);

  const missing = missingConfig(env);
  if (missing.length) {
    console.error('Worker is missing configuration:', missing.join(', '));
    return jsonResponse(503, { status: 'not_ready', error: 'Service is not configured' }, cors);
  }

  const context = { env, pending: [], locals: new Map(), knex: null, waitUntil: (p) => context.pending.push(p) };
  const started = Date.now();
  let response;
  try {
    response = await runWithContext(context, async () => {
      if (url.pathname === '/ready') return withHeaders(await ready(env), cors);

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!app) app = buildApp(env);
        return dispatchApi(request, url, config, cors);
      }

      // The frontend lives on Vercel. Send browsers there instead of a 404, so
      // an old link to the API host still lands somewhere useful.
      const acceptsHtml = String(request.headers.get('accept') || '').includes('text/html');
      if ((request.method === 'GET' || request.method === 'HEAD') && acceptsHtml) {
        return new Response(null, {
          status: 302,
          headers: { ...SECURITY_HEADERS, Location: config.frontendUrl + url.pathname + url.search }
        });
      }
      return jsonResponse(404, { error: 'Route not found' }, cors);
    });
  } finally {
    ctx.waitUntil(drain(context));
  }

  // Path only: query strings can carry OAuth codes.
  console.log(JSON.stringify({ method: request.method, path: url.pathname, status: response.status, ms: Date.now() - started }));
  return response;
}

function withHeaders(response, headers) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) out.headers.set(name, value);
  return out;
}

export default Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    enabled: !!env.SENTRY_DSN,
    environment: env.NODE_ENV || 'production',
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request && event.request.headers) {
        for (const name of Object.keys(event.request.headers)) {
          if (/^(authorization|cookie)$/i.test(name)) delete event.request.headers[name];
        }
      }
      if (event.request) delete event.request.query_string; // may carry OAuth codes
      return event;
    }
  }),
  {
    async fetch(request, env, ctx) {
      try {
        return await handle(request, env, ctx);
      } catch (err) {
        console.error('Request failed:', err && (err.stack || err.message));
        Sentry.captureException(err);
        return jsonResponse(500, { error: 'Something went wrong!' });
      }
    }
  }
);
