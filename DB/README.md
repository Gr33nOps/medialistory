# Database

Schema and migrations for Neon Postgres. One `games` catalog table holds every
kind of media, discriminated by `media_type` (`game`, `movie`, `series`, `anime`).
Games come from IGDB, movies and shows from TMDB, anime from Kitsu.

## Layout

```text
DB/
  schema.postgres.sql   # base schema
  migrations/           # incremental SQL, listed below in the order they were added
  legacy/               # MySQL dump and a one-time data migrator (do not run on Postgres)
  README.md
```

## Apply

1. Run [`schema.postgres.sql`](schema.postgres.sql) in the Neon SQL editor or with `neon psql`.
2. Run every file in [`migrations/`](migrations/) in the order below. They use `IF NOT EXISTS`, so any that the base schema already covers do nothing, and the whole set can be run again safely.

Use a Neon branch for local work so experiments never touch real data.

| Migration | What it adds |
|---|---|
| `add-notes-column.sql` | `user_game_lists.notes`, read by the export endpoint |
| `add-scale-indexes.sql` | Indexes for follow and library lookups |
| `add-token-version.sql` | `users.token_version`. Bumping it ends a user's sessions, for example after a password change |
| `add-username-lower-unique.sql` | Case-insensitive unique usernames. Fails if two existing usernames differ only by case |
| `add-media-types.sql` | `games.media_type` and `games.tmdb_id`, so movies and shows can share the catalog. Existing rows become `media_type = 'game'` |
| `add-auth-id.sql` | `users.auth_id`, mapping a local user to the identity provider |
| `add-anime-and-provider.sql` | Anime as a media type, explicit `provider` and `provider_id` so ids from different providers cannot collide, and episode progress |
| `add-privacy-and-follow-requests.sql` | Private accounts and follow requests |
| `add-list-category.sql` | An optional category on custom lists |
| `add-profile-personalization.sql` | Bio, accent, banner style, Top 10 per category, and which in-progress titles show on a profile |
| `add-activity-index.sql` | Index for the following feed |
| `add-season-ratings.sql` | Season-level ratings for shows and anime |
| `add-season-external-ref.sql` | Ties a cached season back to its catalog entry |
| `add-external-id-map.sql` | `media_external_ids`, a cache of ids resolved across providers. The app works without it, but detail pages then resolve those ids live on every view and export leaves the MyAnimeList id empty |

`migrations/enable-rls.sql` turns on row-level security for every public table. It only matters if the database is also reachable through a REST or Data API, which this app does not use.

`legacy/legacy-mysql-igdb.dump.sql` is an archive of the original MySQL schema and `legacy/migrate_data.js` is the one-time copy that moved it to Postgres. Neither is part of a normal setup.
