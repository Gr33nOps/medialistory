# API on Cloudflare Workers

The MediaListory API runs as one Cloudflare Worker (`medialistory-api`). The
frontend stays on Vercel; Postgres and authentication stay on Neon. How the old
Express server maps onto the Worker is recorded in
[`cloudflare-migration.md`](cloudflare-migration.md).

| Piece | Where |
|---|---|
| Worker entry | [`worker/index.js`](../worker/index.js) |
| Route handlers (shared with the legacy Express server) | [`Backend/`](../Backend) via [`Backend/routes.js`](../Backend/routes.js) |
| Config | [`wrangler.jsonc`](../wrangler.jsonc) |
| Postgres | Hyperdrive binding `HYPERDRIVE` → Neon (query caching **disabled**) |
| Shared state | Durable Object `StateStore` (auth rate limit, OAuth hand-off codes, IGDB token) |
| Catalog rate limit | Rate Limiting binding `CATALOG_RATE_LIMITER` |
| Logs | Workers Logs (`observability.enabled`) |

There is no Cron Trigger. The Express server's catalog warmer only filled one
process's memory, which has no equivalent on Workers, and nothing else runs on a
schedule. Workers do not sleep, so there is no keep-alive either.

## Environment variables

Secrets are set with Wrangler and never committed. Plain settings live in
`vars` in `wrangler.jsonc`.

| Render variable | Worker | Kind | Notes |
|---|---|---|---|
| `DATABASE_URL` | `HYPERDRIVE` binding | Hyperdrive config | The connection string is stored, encrypted, in the Hyperdrive config, not in the Worker. Use Neon's **direct** (non `-pooler`) host; Hyperdrive pools. |
| `JWT_SECRET` | `JWT_SECRET` | secret | Must be **identical** to Render's, or every signed-in user is logged out at cutover. |
| `NEON_AUTH_BASE_URL` | `NEON_AUTH_BASE_URL` | secret | Not public anywhere else, so kept out of the repo. |
| `NEON_AUTH_JWKS_URL` | `NEON_AUTH_JWKS_URL` | secret | Optional; defaults to `<base>/.well-known/jwks.json`. |
| `IGDB_CLIENT_ID` | `IGDB_CLIENT_ID` | secret | |
| `IGDB_CLIENT_SECRET` | `IGDB_CLIENT_SECRET` | secret | The Worker mints and shares the Twitch token itself. |
| `IGDB_ACCESS_TOKEN` | — | dropped | Not needed while the client secret is set. |
| `TMDB_ACCESS_TOKEN` / `TMDB_API_KEY` | same names | secret | Either one. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | same names | secret | Add the Worker callback URL to the Google client first (below). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | same names | secret | A GitHub OAuth App has one callback URL, so the Worker uses its own app (below). |
| `SENTRY_DSN` | `SENTRY_DSN` | secret | Optional. Unset disables Sentry. |
| `FRONTEND_URL` | `FRONTEND_URL` | var | `https://medialistory.vercel.app`. CORS, post-auth redirects, Neon Auth `Origin`. |
| `BACKEND_URL` | `BACKEND_URL` | var | The Worker's own public URL. OAuth callbacks are built from it. |
| `ALLOWED_ORIGINS` | `ALLOWED_ORIGINS` | var | Extra browser origins, comma-separated (e.g. a Vercel preview). |
| `NODE_ENV` | `NODE_ENV` | var | `production`: `Secure` cookies, no error detail, localhost origins refused. |
| `ENRICH_DEALS`, `ENRICH_ANIME`, `ENRICH_EPISODES` | same names | var | `0` switches a source off. |
| `PORT`, `ALLOW_DEGRADED`, `DB_SSL_INSECURE` | — | dropped | No process, no listener, Hyperdrive owns TLS. |
| `REDIS_URL`, `REDIS_PREFIX` | — | dropped | Replaced by the Durable Object and the Rate Limiting binding. |
| `CATALOG_WARM_MS` | — | dropped | Warmer removed. |
| `RENDER`, `RENDER_GIT_COMMIT` | — | dropped | Render-only. |

Bindings (declared in `wrangler.jsonc`): `HYPERDRIVE`, `STATE_STORE`,
`CATALOG_RATE_LIMITER`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in local secrets; the file is git-ignored
```

Point Hyperdrive at a database for local runs. Prefer a Neon **branch** over
production so local writes cannot reach real data:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://…"
npm run dev:worker    # http://localhost:8787, API + the Frontend/ folder
```

`dev:worker` serves `Frontend/` from the same origin as the API
(`wrangler dev --assets Frontend`), so the frontend's `/api` default works
unchanged. Production does not serve static files; Vercel does.

Tests:

```bash
npm test              # unit + smoke tests (Node)
npm run test:worker   # the real Worker on local workerd: probes, CORS, headers, limits
```

## Deploying

One-time setup (per environment; add `--env staging` for staging):

```bash
npx wrangler login

# Neon direct connection string, caching off (read-after-write must hold).
npx wrangler hyperdrive create medialistory-neon --caching-disabled \
  --connection-string="postgres://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require"
# Put the printed id into wrangler.jsonc (hyperdrive[0].id).

# Secrets: one at a time (prompts for the value) ...
npx wrangler secret put JWT_SECRET
# ... or all at once from a git-ignored JSON file, then delete the file.
npx wrangler secret bulk secrets.production.json
```

Deploy:

```bash
npm run deploy:staging
npm run deploy:production
```

The first deploy creates the `StateStore` Durable Object class (migration
`v1`). Set `BACKEND_URL` in `wrangler.jsonc` to the URL Wrangler prints, and
deploy again.

### OAuth callbacks

The provider redirects to `<BACKEND_URL>/api/auth/oauth/<provider>/callback`.

- **Google:** add `https://<worker-host>/api/auth/oauth/google/callback` to the
  existing OAuth client's authorised redirect URIs. Google allows several, so
  Render keeps working while both exist.
- **GitHub:** an OAuth App allows exactly one callback URL. Create a second
  OAuth App for the Worker with callback
  `https://<worker-host>/api/auth/oauth/github/callback` and give the Worker its
  client id and secret. The Render app stays untouched for rollback.

## Verifying a deployment

```bash
curl -s https://<worker-host>/ready
BASE_URL=https://<worker-host> TOKEN=<test account session JWT> node scripts/worker-smoke.mjs
```

The smoke script covers session, library, tracking, seasons, custom lists,
import-style adds, export, profile, social and every catalog proxy, and
removes what it creates. Run it with a test account.

Live logs: `npx wrangler tail` (add `--env staging` for staging), or Workers
Logs in the Cloudflare dashboard. Request logs contain paths only, never query
strings, because OAuth callbacks carry codes there.

## Limits worth knowing

- **CPU time:** Workers Free allows 10 ms of CPU per request (network waits do
  not count). Catalog searches that rank large result sets can exceed that. If
  Workers Logs show `exceededCpu`, move to Workers Paid.
- **Catalog limit** is counted per Cloudflare location (Rate Limiting binding
  semantics); the **auth limit** is global and exact (Durable Object).
- **In-memory caches** (catalog pages, enrichment lookups, Similar Taste) are
  per isolate. A miss goes to the source of truth, so this only affects hit rate.
