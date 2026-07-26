# API ID contracts (clients)

**Product decision:** this deployment is **IGDB / Twitch only**. There is no RAWG mode. Do not send `rawg_id` or assume RAWG payloads.

## Identifiers

| Layer | Field | Format | Notes |
|-------|-------|--------|-------|
| IGDB upstream | `id` | integer | From IGDB API |
| Client / API (external) | `game_id` or `id` on browse cards | `igdb_<igdbId>` string | e.g. `igdb_1942` |
| Postgres `games` | `id` | bigint PK | Internal FK for `user_game_lists`, custom lists |
| Postgres `games` | `igdb_id` | integer UNIQUE | Canonical join key to IGDB |
| Postgres `games` | `game_id` | text UNIQUE | Same as client form `igdb_<n>` |
| Users | `id` | UUID | Supabase Auth user id = `public.users.id` |

### Rules for clients

1. When adding a game from browse/detail, send `game_data` including **`igdb_id`** (number) and metadata. Bare title match is rejected.
2. Collection endpoints may return both `game_id` (client string) and numeric DB ids depending on the route - prefer `igdb_*` strings from the UI layer and numeric ids only when the API already returned them for list membership.
3. Never invent IDs. Persist only what the API returns or what IGDB provided.

## Auth

- `Authorization: Bearer <jwt>` **or** httpOnly cookie `mgl_token` (set on login / OAuth complete)
- JWT payload: `{ userId, tv }` (`tv` = `token_version`)
- Sessions: ~7d default, 30d with remember-me
- `GET /api/auth/session` - restore session from httpOnly cookie when localStorage is empty
- `POST /api/auth/oauth/complete` - body `{ access_token, rememberMe? }`; may return `needsUsername` + `suggestedUsername`
- `PUT /api/auth/username` - claim username after OAuth (auth required)
- `POST /api/auth/logout` - clears cookie (auth optional)
- Same email via Google vs Discord vs password is **not** auto-merged - see `docs/runbook.md` (Account linking)

## Versioning

- Current mounts: `/api/*`
- Compatibility aliases: `/api/v1/*` (same handlers)
- Prefer `/api/v1` for new external clients; `/api` remains for this app.

See also `docs/openapi.yaml` for the locked IGDB proxy + auth surface.
