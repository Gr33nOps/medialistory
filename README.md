# My Game List

Track what you play, rate your collection, and discover games with friends. Catalog data from [IGDB](https://www.igdb.com/) (Twitch).

[![Live demo](https://img.shields.io/badge/demo-live-22c55e?style=flat-square)](https://my-game-list-live.vercel.app)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![CI](https://img.shields.io/github/actions/workflow/status/Gr33nOps/MyGameList/ci.yml?branch=main&style=flat-square)](https://github.com/Gr33nOps/MyGameList/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**Live:** [my-game-list-live.vercel.app](https://my-game-list-live.vercel.app)

## Features

- Browse and search games (genre, platform, sort)
- Email auth plus Google and Discord OAuth
- Personal list: status, score, notes, custom lists, JSON export
- Follow users and public profiles
- Admin and moderator dashboards

## Stack

Vanilla HTML/CSS/JS frontend, Node/Express API, Supabase Postgres + Auth, IGDB. Hosted on Vercel (frontend) and Render (API).

## Quick start

Node.js 18+ required (20 LTS recommended).

```bash
git clone https://github.com/Gr33nOps/MyGameList.git
cd MyGameList
cp .env.example .env
npm install
```

1. Fill `.env` from [`.env.example`](.env.example) (Supabase, JWT, Twitch/IGDB).
2. Apply [`DB/schema.postgres.sql`](DB/schema.postgres.sql) in the Supabase SQL editor (see [`DB/README.md`](DB/README.md)).
3. Run:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). You land on browse home; if you are not signed in, the login form appears.

Do not set `ALLOW_DEGRADED=1` in production.

| Command | Description |
|---------|-------------|
| `npm start` | Run the server |
| `npm run dev` | Nodemon reload |
| `npm test` | Unit + smoke tests |

## Deploy

1. **Render:** Web service, `npm start`, env from `.env.example`. Use the Supabase Session pooler `DATABASE_URL` (exact host from the dashboard, e.g. `aws-1-...`). Set `FRONTEND_URL=https://my-game-list-live.vercel.app` (include `https://`).
2. **Vercel:** Import the repo. [`vercel.json`](vercel.json) rewrites `/api`, `/health`, `/ready` to Render and serves `Frontend/`.
3. **Supabase Auth:** Site URL and redirect URLs for your Vercel origin and `/auth.html`.

Details: [`docs/runbook.md`](docs/runbook.md). Probes: `/health` (up), `/ready` (DB + IGDB).

## Layout

```text
MyGameList/
├── Backend/          Express API (routes + IGDB)
├── Frontend/         Static pages, CSS, JS
├── DB/
│   ├── schema.postgres.sql
│   ├── migrations/   Incremental SQL
│   └── legacy/       Archive + one-time migrator
├── docs/             API notes, OpenAPI, runbook
├── test/             unit / smoke / e2e
└── .github/          CI + issue templates
```

More: [API contracts](docs/API.md) · [OpenAPI](docs/openapi.yaml) · [Runbook](docs/runbook.md)

## License

[MIT](LICENSE) © Gr33nOps
