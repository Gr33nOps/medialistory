const { test } = require('node:test');
const assert = require('node:assert/strict');

const transfer = require('../../Frontend/transfer');

test('Letterboxd export CSV imports watched movies and converts five-star ratings', () => {
  const rows = transfer.parseImport([
    'Date,Name,Year,Letterboxd URI,Rating',
    '2024-02-03,"Paris, Texas",1984,https://boxd.it/2b8G,4.5'
  ].join('\n'), 'auto');

  assert.deepEqual(rows, [{
    title: 'Paris, Texas',
    type: 'movie',
    status: 'completed',
    score: 9,
    year: 1984
  }]);
});

test('IMDb ratings CSV imports titles, completed status, and ten-point scores', () => {
  const rows = transfer.parseImport([
    'Const,Your Rating,Date Rated,Title,Title Type,Release Year',
    'tt0137523,10,2020-01-02,Fight Club,movie,1999'
  ].join('\n'), 'auto');

  assert.equal(rows[0].title, 'Fight Club');
  assert.equal(rows[0].type, 'movie');
  assert.equal(rows[0].status, 'completed');
  assert.equal(rows[0].score, 10);
  assert.equal(rows[0].year, 1999);
});

test('MyAnimeList XML imports anime status, progress, and score', () => {
  const rows = transfer.parseImport(`<?xml version="1.0"?><myanimelist><anime>
    <series_animedb_id>16498</series_animedb_id><series_title>Shingeki no Kyojin</series_title>
    <my_watched_episodes>25</my_watched_episodes><my_score>8</my_score><my_status>Completed</my_status>
  </anime></myanimelist>`, 'auto');

  assert.deepEqual(rows, [{
    title: 'Shingeki no Kyojin', type: 'anime', status: 'completed', score: 8,
    progress: 25, externalId: '16498'
  }]);
});

test('Trakt-style JSON imports nested movies and shows', () => {
  const rows = transfer.parseImport(JSON.stringify([
    { movie: { title: 'Arrival', year: 2016, ids: { tmdb: 329865 } }, rating: 9, rated_at: '2023-01-01T00:00:00Z' },
    { show: { title: 'Severance', year: 2022, ids: { tmdb: 95396 } }, progress: 4 }
  ]), 'auto');

  assert.deepEqual(rows.map(r => [r.title, r.type, r.status, r.score]), [
    ['Arrival', 'movie', 'completed', 9],
    ['Severance', 'series', 'playing', null]
  ]);
});

const backup = {
  collection: [
    { media_type: 'movie', name: 'Fight Club', tmdb_id: 550, released: '1999-10-15', status: 'completed', score: 9, notes: 'Great.', updated_at: '2024-02-03T10:00:00Z' },
    { media_type: 'anime', name: 'Cowboy Bebop', status: 'completed', score: 10, progress: 26, updated_at: '2024-01-01T00:00:00Z' },
    { media_type: 'game', name: 'Hades', igdb_id: 113112, status: 'playing', score: 8, progress_hours: 20 }
  ]
};

test('Letterboxd export uses its documented TMDB and Rating10 columns', () => {
  const file = transfer.buildExport(backup, 'letterboxd');
  assert.equal(file.filename, 'medialistory-letterboxd-movies.csv');
  assert.match(file.text, /^tmdbID,Title,Year,Rating10,WatchedDate,Review\r?\n/);
  assert.match(file.text, /550,Fight Club,1999,9,2024-02-03,Great\./);
  assert.doesNotMatch(file.text, /Cowboy Bebop|Hades/);
});

test('MyAnimeList export creates importable anime XML', () => {
  const file = transfer.buildExport(backup, 'myanimelist');
  assert.equal(file.filename, 'medialistory-myanimelist-anime.xml');
  assert.match(file.text, /<series_title>Cowboy Bebop<\/series_title>/);
  assert.match(file.text, /<my_status>Completed<\/my_status>/);
  assert.match(file.text, /<my_watched_episodes>26<\/my_watched_episodes>/);
  assert.doesNotMatch(file.text, /Fight Club|Hades/);
});

test('portable export keeps every media type and tracking field', () => {
  const file = transfer.buildExport(backup, 'portable');
  assert.match(file.text, /^Title,Type,Status,Score,Year,Progress,Progress Hours,Provider ID,Notes\r?\n/);
  assert.match(file.text, /Hades,game,playing,8,,,20,113112,/);
  assert.match(file.text, /Severance|Cowboy Bebop/);
});

test('MediaListory backup import keeps notes and progress in the add payload', () => {
  const rows = transfer.parseImport(JSON.stringify(backup), 'auto');
  const anime = rows.find(row => row.title === 'Cowboy Bebop');
  const movie = rows.find(row => row.title === 'Fight Club');
  assert.equal(anime.progress, 26);
  assert.equal(movie.notes, 'Great.');
  assert.deepEqual(transfer.buildImportPayload(movie, { game_id: 'tmdb_movie_550' }), {
    game_data: { game_id: 'tmdb_movie_550' }, status: 'completed', score: 9,
    progress: undefined, progress_hours: undefined, notes: 'Great.'
  });
});
