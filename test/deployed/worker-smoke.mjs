#!/usr/bin/env node
/* End-to-end smoke test for a deployed API (staging Worker, production Worker
   or the legacy Node server - they must behave the same).

   It signs in as an existing account through a session token, walks through
   every area the frontend uses (session, library, tracking, seasons, custom
   lists, import-style adds, export, social, profile, catalog proxies,
   enrichment) and removes everything it created. Run it against staging with
   a throwaway account, not against production data.

     BASE_URL=https://medialistory-api-staging.<sub>.workers.dev \
     TOKEN=<session JWT for a test account> \
     ORIGIN=https://medialistory.vercel.app \
     node test/deployed/worker-smoke.mjs

   Exit code is the number of failed checks. The token is never printed. */

const BASE = String(process.env.BASE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.TOKEN || '';
const ORIGIN = process.env.ORIGIN || 'https://medialistory.vercel.app';
if (!BASE || !TOKEN) {
  console.error('Set BASE_URL and TOKEN.');
  process.exit(2);
}

let failures = 0;
const results = [];

async function api(method, path, { body, auth = true, headers = {} } = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      Origin: ORIGIN,
      ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, json, text, ms: Date.now() - started };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(['PASS', name, detail || '']);
  } catch (err) {
    failures++;
    results.push(['FAIL', name, err.message]);
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

function expectStatus(r, status, label = '') {
  expect(r.status === status, `${label}expected ${status}, got ${r.status}: ${r.text.slice(0, 160)}`);
}

// Test titles, chosen for stable ids.
const MOVIE = { media_type: 'movie', tmdb_id: 27205, name: 'Inception', released: '2010-07-15' };
const SERIES = { media_type: 'series', tmdb_id: 1396, name: 'Breaking Bad', released: '2008-01-20', number_of_episodes: 62 };
const GAME = { igdb_id: 1942, name: 'The Witcher 3: Wild Hunt', released: '2015-05-19' };

const created = { titles: [], lists: [] };
let me = null;

await check('probes: /health and /ready', async () => {
  const h = await api('GET', '/health', { auth: false });
  expectStatus(h, 200, '/health ');
  const r = await api('GET', '/ready', { auth: false });
  expectStatus(r, 200, '/ready ');
  expect(r.json.db === true, 'database not ready');
  return `ready in ${r.ms} ms, igdb=${r.json.igdb}`;
});

await check('CORS for the frontend origin', async () => {
  const r = await api('OPTIONS', '/api/user/games', {
    auth: false,
    headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }
  });
  expectStatus(r, 204);
  expect(r.headers.get('access-control-allow-origin') === ORIGIN, 'origin not allowed');
});

await check('auth: session restore and /me', async () => {
  const s = await api('GET', '/api/auth/session');
  expectStatus(s, 200, 'session ');
  expect(s.json.token && s.json.user && s.json.user.id, 'session shape');
  const m = await api('GET', '/api/auth/me');
  expectStatus(m, 200, 'me ');
  me = m.json.user;
  const v = await api('GET', '/api/auth/verify');
  expectStatus(v, 200, 'verify ');
  return `user ${me.username}`;
});

await check('auth: public config and username check', async () => {
  const c = await api('GET', '/api/auth/public-config', { auth: false });
  expectStatus(c, 200);
  expect(Array.isArray(c.json.providers), 'providers');
  const u = await api('GET', `/api/auth/check-username/${encodeURIComponent(me.username)}`, { auth: false });
  expect(u.json && u.json.exists === true, 'own username should exist');
  return `providers=${c.json.providers.join(',') || 'none'}`;
});

await check('catalog: IGDB, TMDB, Kitsu, people, enrichment', async () => {
  const igdb = await api('POST', '/api/igdb/games', { body: { search: 'witcher 3', limit: 5 } });
  expectStatus(igdb, 200, 'igdb ');
  const tmdb = await api('POST', '/api/tmdb/movies', { body: { search: 'inception', limit: 5 } });
  expectStatus(tmdb, 200, 'tmdb ');
  const kitsu = await api('POST', '/api/kitsu/anime', { body: { search: 'frieren', limit: 5 } });
  expectStatus(kitsu, 200, 'kitsu ');
  const genres = await api('POST', '/api/tmdb/genres', { body: { mediaType: 'series' } });
  expectStatus(genres, 200, 'genres ');
  const people = await api('POST', '/api/people/search', { body: { query: 'nolan' } });
  expectStatus(people, 200, 'people ');
  const enrich = await api('GET', '/api/enrich/series/1396');
  expectStatus(enrich, 200, 'enrich ');
  return `igdb X-Cache=${igdb.headers.get('x-cache')} (${igdb.ms} ms), tmdb ${tmdb.ms} ms, kitsu ${kitsu.ms} ms`;
});

await check('library: add (import-style payloads), list, refs, stats', async () => {
  for (const title of [MOVIE, SERIES, GAME]) {
    const r = await api('POST', '/api/user/games', { body: { game_data: title, status: 'plan_to_play' } });
    if (r.status === 400 && /already in your list/i.test(r.text)) {
      throw new Error(`test account already has ${title.name}; use an empty account`);
    }
    expectStatus(r, 201, `add ${title.name} `);
    created.titles.push({ id: r.json.game_id, name: title.name });
  }
  const list = await api('GET', '/api/user/games?sort=name&order=asc');
  expectStatus(list, 200);
  const ids = new Set(list.json.games.map((g) => String(g.game_id)));
  expect(created.titles.every((t) => ids.has(String(t.id))), 'added titles missing from library (read-after-write)');
  const refs = await api('GET', '/api/user/games/refs');
  expectStatus(refs, 200, 'refs ');
  const stats = await api('GET', '/api/user/stats');
  expectStatus(stats, 200, 'stats ');
  return `${created.titles.length} titles added and read back`;
});

await check('tracking: status, score, progress, notes', async () => {
  const movie = created.titles[0];
  const u = await api('PUT', `/api/user/games/${movie.id}`, {
    body: { status: 'completed', score: 9, notes: 'smoke test note' }
  });
  expectStatus(u, 200);
  const list = await api('GET', '/api/user/games?media_type=movie');
  const row = list.json.games.find((g) => String(g.game_id) === String(movie.id));
  expect(row && row.status === 'completed' && Number(row.score) === 9 && row.notes === 'smoke test note', 'update not visible');
});

await check('seasons: list, rate, clear', async () => {
  const ref = 'tmdb_series_1396';
  // Season lists are cached in the background after an add; allow a moment.
  let seasons = null;
  for (let i = 0; i < 5; i++) {
    const r = await api('GET', `/api/user/games/${ref}/seasons`);
    expectStatus(r, 200, 'seasons ');
    seasons = r.json.seasons;
    if (seasons && seasons.length) break;
    await new Promise((r2) => setTimeout(r2, 1500));
  }
  expect(seasons && seasons.length >= 5, `expected Breaking Bad seasons, got ${seasons && seasons.length}`);
  const put = await api('PUT', `/api/user/games/${ref}/seasons/1`, { body: { status: 'completed', score: 8 } });
  expectStatus(put, 200, 'rate season ');
  const del = await api('DELETE', `/api/user/games/${ref}/seasons/1`);
  expectStatus(del, 200, 'clear season ');
  return `${seasons.length} seasons`;
});

await check('custom lists: create, add, update, remove, delete', async () => {
  const c = await api('POST', '/api/user/lists', { body: { name: 'Smoke test list', description: 'temporary', category: 'movie' } });
  expect(c.status === 201 || c.status === 200, `create list: ${c.status} ${c.text.slice(0, 120)}`);
  const listId = (c.json.list && c.json.list.id) || c.json.id;
  expect(listId, 'list id missing');
  created.lists.push(listId);
  const add = await api('POST', `/api/user/lists/${listId}/games`, { body: { game_data: MOVIE } });
  expect(add.status === 201 || add.status === 200, `add to list: ${add.status} ${add.text.slice(0, 120)}`);
  const got = await api('GET', `/api/user/lists/${listId}`);
  expectStatus(got, 200, 'get list ');
  const lists = await api('GET', '/api/user/lists');
  expectStatus(lists, 200, 'lists ');
  const rename = await api('PUT', `/api/user/lists/${listId}`, { body: { name: 'Smoke test list 2', description: 'temporary' } });
  expectStatus(rename, 200, 'rename ');
});

await check('export: full and per-category backup', async () => {
  const full = await api('GET', '/api/user/export');
  expectStatus(full, 200);
  expect(/attachment; filename="medialistory-backup.json"/.test(full.headers.get('content-disposition') || ''), 'content-disposition');
  expect(full.json.product === 'MediaListory', 'export shape');
  const movies = await api('GET', '/api/user/export?category=movie');
  expect(movies.json.category === 'movie', 'category export');
  return `${(full.json.collection || full.json.games || []).length} entries`;
});

await check('profile: read and round-trip update', async () => {
  const p = await api('GET', '/api/user/profile');
  expectStatus(p, 200);
  const u = p.json.user;
  const put = await api('PUT', '/api/user/profile', {
    body: { display_name: u.display_name, email: u.email, avatar_url: u.avatar_url && /^https:/.test(u.avatar_url) && !/\/api\/users\//.test(u.avatar_url) ? u.avatar_url : null, bio: u.bio }
  });
  expectStatus(put, 200, 'update ');
  const top = await api('GET', '/api/user/profile/top');
  expectStatus(top, 200, 'top ');
});

await check('social: search, followers, following, activity, discover, own profile', async () => {
  for (const path of ['/api/users/search?query=a', '/api/followers', '/api/following', '/api/following/activity',
    '/api/discover', '/api/discover/similar?limit=6', '/api/follow/requests', `/api/users/${me.id}`, `/api/users/${me.id}/games`, `/api/users/${me.id}/lists`]) {
    const r = await api('GET', path);
    expectStatus(r, 200, `${path} `);
  }
});

await check('cleanup: remove everything this run created', async () => {
  for (const listId of created.lists) {
    const r = await api('DELETE', `/api/user/lists/${listId}`);
    expectStatus(r, 200, 'delete list ');
  }
  for (const t of created.titles) {
    const r = await api('DELETE', `/api/user/games/${t.id}`);
    expectStatus(r, 200, `remove ${t.name} `);
  }
  const after = await api('GET', '/api/user/games');
  const left = after.json.games.filter((g) => created.titles.some((t) => String(t.id) === String(g.game_id)));
  expect(left.length === 0, 'titles left behind');
});

for (const [state, name, detail] of results) {
  console.log(`${state}  ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failures}/${results.length} checks passed against ${BASE}`);
process.exit(failures);
