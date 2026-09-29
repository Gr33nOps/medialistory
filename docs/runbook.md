# MediaListory operations runbook

Product stack: **Neon Postgres** + **Neon Auth** (Better Auth). Catalog: **IGDB** (games) + **TMDB** (movies/series). Media discriminated by `games.media_type`.

## Health

| Probe | Meaning |
|-------|---------|
| `GET /health` | Process alive |
| `GET /ready` | Postgres reachable; also reports IGDB env + rate-limit store mode |

If `/ready` is 503, fix `DATABASE_URL` / network / Neon project status before debugging app logic. Neon auto-resumes a suspended project on the next connection.

## Neon backups / branching

1. Neon Console → Project → **Backups / Restore** (point-in-time within the plan's history window).
2. Neon **branches** are cheap copy-on-write clones - branch `production` for a staging/test copy before risky changes.
3. Schema source of truth: `DB/schema.postgres.sql` + ordered files in `DB/README.md` (apply via `neon psql` or the Neon SQL editor).
4. Do **not** restore `DB/legacy/legacy-mysql-igdb.dump.sql` into Postgres.

## Auth notes

Identity is **Neon Auth** (Better Auth). The backend verifies credentials with Neon Auth (email/password via `/sign-in/email`, OAuth via a JWKS-verified JWT) and then mints the app's own JWT (`{ userId, tv }`, HS256) - also set as the httpOnly `mgl_token` cookie. `public.users` (keyed by the Neon Auth user id, also stored in `auth_id`) is the source of truth for username, roles, and ban state. Email/password sign-in is configured with **verification not required**, so register signs the user in immediately.

Manage with the CLI: `neon neon-auth status|config|oauth-provider|domain|user --project-id <id> --branch production`.

### Google (+ Discord) OAuth (Continue with…)

App buttons ask Neon Auth for the provider URL (`POST {NEON_AUTH_BASE_URL}/sign-in/social`), redirect the browser, and on return exchange the Neon Auth session for a JWT (`GET {NEON_AUTH_BASE_URL}/token`) which is posted to `POST /api/auth/oauth/complete`.

1. **Trusted domains** (CSRF): add every app origin, or Neon Auth rejects the calls.
   - `neon neon-auth domain add https://my-game-list-live.vercel.app`
   - `neon neon-auth domain allow-localhost enable` (local dev)
2. **Enable Google:** Neon Console → Auth → providers (a shared dev key is on by default and shows Neon branding; add your own Google OAuth client for production).
3. **Enable Discord:** add it via `neon neon-auth oauth-provider` / the Console with a Discord app's client id + secret (not enabled by default).
4. First OAuth login may show an optional username picker (`PUT /api/auth/username`).
5. **Cross-origin note:** the browser calls the Neon Auth origin with credentials for the token exchange; this relies on the trusted-domain CORS config and third-party cookies. Test the flow in the target browser.

### Account linking (same email, different providers)

Neon Auth (Better Auth) treats each provider identity separately unless linked. Email/password and Google with the same address are distinct users unless account-linking is enabled in the Neon Auth config. Prefer one path per person; to merge manually, export (`GET /api/user/export`), pick a canonical account, re-add. Password reset needs a configured Neon Auth email provider (`neon neon-auth config email-provider`); until then `/api/auth/forgot-password` returns the generic message but sends nothing.

### Sessions (httpOnly cookie + Bearer)

- Login / OAuth complete set `Set-Cookie: mgl_token=…; HttpOnly; SameSite=Lax` (Secure in `NODE_ENV=production`).
- `Authorization: Bearer <jwt>` still works (and is what the SPA stores in `localStorage`).
- Logout: `POST /api/auth/logout` clears the cookie (no auth required). Frontend also clears localStorage.
- Stale JS: after deploy, hard-refresh or clear site data for `localhost` (or use Incognito). API responses use `Cache-Control: no-store`.

### Production deploy checklist

1. Deploy the API Worker (`npm run deploy:production`) and the frontend (Vercel). See [Deploy](#deploy-cloudflare-workers-api--vercel-frontend) below.
2. Add the frontend origin as a Neon Auth trusted domain (`neon neon-auth domain add https://medialistory.vercel.app`). The API sends that origin on its server-side Neon Auth calls, so the Worker host itself does not need to be listed.
3. Enable the Google (and optionally Discord) OAuth provider in the Neon Console with your own OAuth client for production (the default shared key shows Neon branding).
4. Rate limits need no setup: auth limits live in the `StateStore` Durable Object, catalog limits in the Rate Limiting binding.
5. Smoke: `/health`, `/ready`, register/login, add game, follow.

## Environment / secret rotation

Rotate immediately if a key was pasted into chat, logs, or a public repo:

| Secret | Where | Action |
|--------|-------|--------|
| `JWT_SECRET` | `.env` | Generate new value; all users must re-login |
| `NEON_AUTH_*` | Neon Console → Auth | Rotate/reconfigure via `neon neon-auth`; re-verify sign-in |
| `DATABASE_URL` password | Neon Console → Roles (reset password) | Reset the role password; update the pooled URL |
| `IGDB_CLIENT_SECRET` | Twitch developer console | Rotate secret; clear `IGDB_ACCESS_TOKEN` so app refreshes |

After JWT rotation, bump is automatic (new signatures). After password change for a user, `token_version` invalidates old app JWTs.

## Twitch / IGDB credentials

1. [Twitch developer console](https://dev.twitch.tv/console/apps) → your app.
2. Set `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` in `.env`.
3. App fetches an app access token via client credentials (see `Backend/igdb.js`).
4. Optional: set `IGDB_ACCESS_TOKEN` temporarily; prefer secret-based refresh.
5. On 401 from IGDB, restart after rotating the secret; check Twitch app is not disabled.

## TMDB credentials (Movies + Series)

1. [TMDB → Settings → API](https://www.themoviedb.org/settings/api).
2. Set **either** `TMDB_ACCESS_TOKEN` (v4 Read Access Token, preferred) **or** `TMDB_API_KEY` (v3) in `.env`.
3. Movies/series proxies live in `Backend/tmdb.js`; genre lists are cached 24h.
4. If TMDB is unset, `/api/tmdb/*` returns `503`/`500` and the Movies/Series pages show an error - **games are unaffected**.
5. Requires the `add-media-types` DB migration (adds `media_type` + `tmdb_id`); without it, movie/series writes fail.

## Degraded mode

- `ALLOW_DEGRADED=1` - process stays up without DB (local catalog-only checks). **Never in production.**
- IGDB/TMDB outage - list endpoints may return locally cached `games` rows with `X-Cache: DEGRADED`.

## User data export

Authenticated users can download their data:

`GET /api/user/export` (Bearer JWT) → JSON of profile fields, collection, and custom lists.

## Incident checklist

1. Check `/health` and `/ready`.
2. Check Neon project status + Twitch/IGDB + TMDB status.
3. Tail the Worker: `npx wrangler tail` (or Workers Logs in the Cloudflare dashboard). Request logs show paths only.
4. Check the Hyperdrive config and the Neon compute (Neon suspends idle computes; the first query after that is slower, not failing).
5. If auth mass-fails after deploy, verify `JWT_SECRET` was not changed unintentionally.

## Deploy: Cloudflare Workers (API) + Vercel (Frontend)

- **API:** the `medialistory-api` Worker at `https://medialistory-api.gr33nops.workers.dev`. Config in [`wrangler.jsonc`](../wrangler.jsonc); secrets via `wrangler secret`. Full setup, the env-var mapping and local development are in [`cloudflare-workers.md`](cloudflare-workers.md).
- **Staging:** `medialistory-api-staging` on the Neon branch `cf-worker-staging` (`npm run deploy:staging`). Verify with `test/deployed/worker-smoke.mjs` before production.
- **Frontend:** static `Frontend/` on Vercel per [`vercel.json`](../vercel.json). The API origin is `API_ORIGIN` in [`Frontend/common.js`](../Frontend/common.js) and must also be in the CSP `connect-src`.
- **Order:** deploy the Worker first, check `/ready` and the smoke test, then deploy the frontend.

Workers do not sleep, so there is no cold start to wait out and no keep-alive job.
