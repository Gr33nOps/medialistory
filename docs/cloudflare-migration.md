# Render → Cloudflare Workers migration

This is the record of moving the MediaListory API from a Node/Express server on a
single host to Cloudflare Workers. Section 1 is the inventory of the Express backend as it ran
on Render, taken before any code changed. Section 2 lists everything in that
backend that assumes a long-lived Node process, and what replaces it.
Deployment, local development and the environment-variable mapping live in
[`cloudflare-workers.md`](cloudflare-workers.md).

What does not move: the static frontend stays on Vercel, and PostgreSQL and
authentication stay on Neon (Neon Postgres + Neon Auth). No table, row or
schema changes are part of this migration.

## 1. Inventory of the Render backend (`Backend/server.js`)

### 1.1 Request pipeline

Order matters. A request passed through these, top to bottom:

| # | Middleware | Behaviour |
|---|---|---|
| 1 | `instrument.js` | Sentry init when `SENTRY_DSN` is set; strips `authorization`/`cookie` from events. |
| 2 | `trust proxy 1` | `req.protocol` is `https` behind Render's TLS terminator (avatar URLs depend on it). |
| 3 | `helmet` | Default helmet headers plus a CSP for the self-served frontend, `Referrer-Policy: strict-origin-when-cross-origin`, no COEP. |
| 4 | `compression` | gzip. |
| 5 | `morgan` | Access log (`combined` in production). |
| 6 | `cors` | See 1.4. A disallowed origin becomes an error → `403 {"error":"CORS blocked"}`. |
| 7 | `express.json({limit:'400kb'})` | JSON bodies only (`application/json`). Malformed or oversize bodies fell through to the generic error handler (`500 Something went wrong!`). |
| 8 | `/api` cache headers | `Cache-Control: no-store, no-cache, must-revalidate, private`, `Pragma: no-cache`; ETags disabled app-wide. |
| 9 | Route mounts | See 1.2. Rate limiters are attached per mount. |
| 10 | Static `Frontend/` + named HTML routes | Render also served the whole frontend as a same-origin fallback. |
| 11 | Error handler | CORS error → 403; anything else → `500 {"error":"Something went wrong!"}` (+`message` outside production). |
| 12 | 404 | `GET` with `Accept: text/html` → `Frontend/404.html`; otherwise `404 {"error":"Route not found"}`. |

### 1.2 Routes

Every `/api/...` mount below is also mounted under `/api/v1/...` with the same
handlers and limiters (compatibility alias for external clients).

Auth column: **public** = no token needed; **optional** = token honoured if
present (banned users get 403); **user** = `verifyToken` + `checkBanned`;
**mod** / **admin** = role check against `public.users`.

**Probes (no `/api` prefix)**

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` | public | `{status:"ok", uptime}` |
| GET | `/ready` | public | `{status:"ready", db:true, igdb:bool, rateLimitStore}` or `503 {status:"not_ready", db:false}` |

**`/api/auth`** (`auth.js`): auth limiter: 40 requests / 15 min / IP, except
`GET /public-config`, `GET /session`, `GET /me`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/public-config` | public | `{providers:[...]}` configured social providers |
| GET | `/oauth/:provider/start` | public | Sets `mgl_oauth` state cookie, 302 to Google/GitHub |
| GET | `/oauth/:provider/callback` | public | Code exchange, user upsert, sets `mgl_token` cookie, mints one-time hand-off code, 302 to `FRONTEND_URL/auth.html?oauth=done&code=…` (errors: `?oauth_error=…`) |
| POST | `/oauth/exchange` | public | `{code}` → `{token, user}`; single use, 2 min TTL |
| POST | `/oauth/complete` | public | `{token (Neon Auth JWT), rememberMe}` → session |
| PUT | `/username` | user | |
| POST | `/register` | public | Neon Auth sign-up, local user row, session |
| POST | `/verify-email`, `/resend-verification` | public | Static success (verification disabled in Neon Auth) |
| GET | `/check-username/:username` | public | `{exists}` |
| POST | `/login` | public | `{emailOrUsername, password, rememberMe}` → `{token, user, rememberMe}` + cookie |
| GET | `/session` | token | Re-issues a 30-day JWT; 401/403 on invalid/banned/stale `tv` |
| GET | `/verify`, `/me` | user (`verifyToken` only) | |
| POST | `/forgot-password` | public | Always 200 (no account enumeration) |
| POST | `/reset-password` | public | |
| POST | `/logout` | public | Clears `mgl_token` |

**`/api`** (`home.js`): `GET /games`, `GET /games/:id`, public catalog reads from Postgres.

**`/api/user`** (three routers, tried in this order)

| Router | Routes (all **user**) |
|---|---|
| `profile.js` | `GET/PUT /profile`, `GET /profile/top`, `PUT /profile/top/:mediaType`, `PUT /profile/current`, `PUT /password`, `DELETE /data`, `DELETE /account` |
| `library.js` | `POST /games`, `GET /games/refs`, `GET /games`, `PUT/DELETE /games/:gameId`, `GET /stats`, `GET/POST /lists`, `GET/PUT/DELETE /lists/:listId`, `POST /lists/:listId/games`, `PUT/DELETE /lists/:listId/games/:gameId`, `GET /export` (JSON download, `Content-Disposition: attachment`) |
| `seasons.js` | `GET /games/:ref/seasons`, `PUT/DELETE /games/:ref/seasons/:number` |

`library.js` also registers a router-level hook: after any successful non-GET,
the user's Similar Taste cache entry is dropped (`res.on('finish')`).

**`/api`** (`friends.js`, all **user**): `GET /users/search`,
`GET /following/activity`, `GET /discover/similar`, `GET /discover`,
`GET /following`, `GET /followers`, `GET /follow/requests`,
`POST/DELETE /follow/:userId`, `POST /follow/requests/:requesterId/accept|reject`,
`GET /follow/status/:userId`.

**`/api/users`** (`userProfile.js`): `GET /:userId/avatar` (**public**, immutable
image, `Cross-Origin-Resource-Policy: cross-origin`, ETag/304), and **user**:
`GET /:userId`, `/:userId/compare`, `/:userId/games`, `/:userId/followers`,
`/:userId/following`, `/:userId/lists`, `/:userId/lists/:listId`.

**`/api/admin`** (**admin**): `GET /users`, `PUT /users/:id/ban|unban|promote|demote`,
`DELETE /users/:id`, `GET /stats`, `GET /activity`.
**`/api/moderator`** (**mod**): `GET /stats`, `GET /users`, `PUT /users/:id/ban|unban`,
`GET /activity`. Moderator actions are written to `moderator_activity`.

**Catalog proxies** (**optional** auth). One shared "catalog" limiter:
60 requests / min / IP across IGDB, TMDB, Kitsu and enrichment.

| Mount | Routes | Upstream |
|---|---|---|
| `/api/igdb` | `POST /games`, `/genres`, `/platforms`, `/game_modes` | IGDB (Twitch OAuth app token) |
| `/api/tmdb` | `POST /movies`, `/series`, `/genres`, `/languages` | TMDB v3 (Bearer or API key) |
| `/api/kitsu` | `POST /anime`, `/genres` | Kitsu (keyless) |
| `/api/enrich` | `GET /game/:igdbId`, `/anime/:kitsuId`, `/series/:tmdbId` | CheapShark, Jikan, AnimeThemes, TVmaze (keyless) |
| `/api/people` | `POST /`, `POST /search` | TMDB people, Kitsu characters, IGDB companies (**no limiter**) |

Proxies write fetched titles through to `games` (fire-and-forget) and fall back
to that table when an upstream fails (`X-Cache: DB|DEGRADED`, `X-Degraded`).

### 1.3 Response contracts the frontend relies on

- Errors are always JSON `{error}` (sometimes `reason`, `message` outside production).
- Status codes per route as above; 401 `Unauthorized` / `Invalid token` /
  `Session expired…`, 403 banned, 429 `{error:"Too many auth requests, please try again later"}`
  or `{error:"Too many game data requests, please slow down"}` with `RateLimit-*` + `Retry-After` headers.
- Custom headers: `X-Has-More`, `X-Sort-State`, `X-Filters-Applied` (exposed to
  browsers via CORS), plus `X-Cache`, `X-Degraded`, `X-Enrich-Sources` (not exposed).
- Avatar URLs are absolute URLs on the API origin: `<api>/api/users/:id/avatar?v=<ms>[&t=gif]`.

### 1.4 Authentication and sessions

- Identity: Neon Auth (Better Auth REST) for email/password sign-up, sign-in,
  password change and reset; Google/GitHub via direct OAuth2 on the API origin.
  Server-to-server calls send `Origin: FRONTEND_URL`, which must be a Neon Auth
  trusted domain.
- App session: HS256 JWT signed with `JWT_SECRET`, payload `{userId, tv}`,
  7 days (30 with remember-me). Accepted as `Authorization: Bearer` or the
  `mgl_token` cookie (HttpOnly, SameSite=Lax, Secure in production).
  `tv` must equal `users.token_version` (bumped on password change).
- The frontend (Vercel) is cross-origin to the API, so it stores the JWT in
  `localStorage` and sends Bearer; OAuth uses the one-time hand-off code.
- Roles and bans are read from `public.users` on every protected request.

### 1.5 CORS

Allowed origins: `FRONTEND_URL`, `BACKEND_URL`, each of `ALLOWED_ORIGINS`
(comma-separated), and any `http(s)://localhost|127.0.0.1[:port]`, plus requests
with no `Origin`. `credentials: true`; preflight answers 204 with methods
`GET,HEAD,PUT,PATCH,POST,DELETE` and the requested headers reflected.

### 1.6 Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | server.js (Knex/pg) | **required**, secret |
| `JWT_SECRET` | server.js, auth.js | **required**, secret |
| `NEON_AUTH_BASE_URL` | neonAuth.js | **required** |
| `NEON_AUTH_JWKS_URL` | neonAuth.js | defaults from base |
| `FRONTEND_URL` | CORS, redirects, Neon Auth `Origin` | |
| `BACKEND_URL` | OAuth callback URL, CORS | |
| `ALLOWED_ORIGINS` | CORS | |
| `NODE_ENV` | cookie `Secure`, error detail | |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | auth.js | secrets; unset pair hides the button |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `IGDB_ACCESS_TOKEN` | igdb.js | secrets |
| `TMDB_ACCESS_TOKEN` / `TMDB_API_KEY` | tmdb.js, people.js, seasonSources.js | secrets |
| `ENRICH_DEALS`, `ENRICH_ANIME`, `ENRICH_EPISODES` | enrich.js | `0` switches a source off |
| `SENTRY_DSN` | instrument.js | optional, secret |
| `PORT`, `ALLOW_DEGRADED`, `DB_SSL_INSECURE` | server.js | process/driver knobs |
| `REDIS_URL`, `REDIS_PREFIX` | rateLimitStore.js | optional shared limiter store |
| `CATALOG_WARM_MS` | igdb.js | warmer interval |
| `RENDER`, `RENDER_GIT_COMMIT` | server.js, instrument.js | set by Render |
| `NEON_PROJECT_ID` | docs/CLI only | not read by code |

### 1.7 Scheduled and background work

- `igdb.js` starts a warmer on boot (`setTimeout` 15 s, then `setInterval`
  every `CATALOG_WARM_MS`, default 30 min) that fills the in-process genre,
  platform and first-page caches and writes games through to Postgres.
- `.github/workflows/keepalive.yml` pings `/ready` three times a week to keep
  the Render service and Neon awake.
- Fire-and-forget write-through after responses (`persistGames`,
  `persistMedia`, `persist` in igdb/tmdb/kitsu).

### 1.8 External services

Neon Postgres, Neon Auth, Google OAuth, GitHub OAuth, Twitch token endpoint,
IGDB, TMDB, Kitsu, CheapShark, Jikan, AnimeThemes, TVmaze, Sentry (optional).

## 2. Process assumptions and their Worker replacements

| Render assumption | Why it breaks on Workers | Replacement |
|---|---|---|
| `app.listen()`, Express, helmet, cors, compression, morgan | No listening process; Express needs Node's HTTP server | `worker/index.js` fetch handler with a small Express-compatible router (`Backend/http/router.js`) so the same route modules run unchanged; headers, CORS and logging are implemented directly; Cloudflare compresses at the edge |
| One Knex pool for the process | I/O objects cannot be shared across requests | A Knex instance per request over Hyperdrive, created lazily and destroyed after the response and its background work (`ctx.waitUntil`) |
| `DATABASE_URL` + TLS options | Hyperdrive owns the origin connection | `HYPERDRIVE` binding, caching **disabled** (read-after-write must stay consistent) |
| In-memory OAuth hand-off codes | Callback and exchange can land on different isolates | Durable Object (`StateStore`), single use, 2 min expiry |
| `express-rate-limit` (memory/Redis) | No shared process memory | Auth: exact 40 / 15 min per IP in the `StateStore` Durable Object. Catalog: Workers Rate Limiting binding, 60 / 60 s per IP |
| In-memory Twitch/IGDB token | Every new isolate would mint a new token | Token shared through `StateStore`, minted only when missing or near expiry |
| `setInterval` catalog warmer | No background process | Removed. It only filled one process's memory; a cron run would warm an isolate no visitor uses. No Cron Trigger is needed |
| Fire-and-forget promises | Work after the response is cancelled | `background()` registers them with `ctx.waitUntil` |
| Shared single-flight promises / queued limiter chain | Promises must not cross request contexts | Single-flight scoped to the request; the per-host limiter spaces calls by timestamp instead of a shared promise chain |
| `jsonwebtoken` | Node crypto | `jose` (Web Crypto), same HS256 tokens: sessions issued by Render stay valid on the Worker and vice versa |
| `node-fetch` | Not needed | Global `fetch` (Node 18+ and Workers) |
| Keep-alive workflow, frontend "waking the server" panel | Workers do not sleep | Deleted at cutover |
| Static frontend fallback on the API host | Vercel serves the frontend | API-only Worker; browser navigations to non-API paths redirect to `FRONTEND_URL` |
| In-process TTL caches (catalog, enrichment, Similar Taste) | Per isolate, not per process | Kept as-is; they are best-effort and every miss falls through to the source of truth |

## 3. Outcome

The Worker serves the same routes, methods, request and response shapes, status
codes and error messages as the Express server. Sessions issued by either backend
are accepted by the other, because both sign the same HS256 tokens with the same
secret. Two bugs found by the staging smoke test were fixed on the way: adding a
title to a custom list, and exporting a backup when the optional
`media_external_ids` table is missing.

The Express server (`npm start`) is kept as a fallback. Rolling back means pointing
the frontend's `API_ORIGIN` (`Frontend/common.js`) and the CSP in `vercel.json`
back at it; the database and the session secret are shared, so no data moves.
