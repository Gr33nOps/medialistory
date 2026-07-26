const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeToken,
  clampInt,
  slugify,
  mapIgdbToRow,
  parseIgdbClientId,
  toClientGameId
} = require('../../Backend/igdbUtils');

test('sanitizeToken strips Apicalypse injection chars', () => {
  assert.equal(sanitizeToken('Foo"; drop --'), 'Foo drop --');
  assert.equal(sanitizeToken('x'.repeat(100), 10).length, 10);
});

test('clampInt bounds values', () => {
  assert.equal(clampInt('20', 1, 50, 10), 20);
  assert.equal(clampInt('999', 1, 50, 10), 50);
  assert.equal(clampInt('nope', 1, 50, 10), 10);
});

test('slugify normalizes names', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify(''), 'game');
});

test('parseIgdbClientId accepts igdb_ prefix and numbers', () => {
  assert.equal(parseIgdbClientId('igdb_1942'), 1942);
  assert.equal(parseIgdbClientId(1942), 1942);
  assert.equal(parseIgdbClientId('nope'), null);
});

test('toClientGameId formats contract id', () => {
  assert.equal(toClientGameId(12), 'igdb_12');
});

test('mapIgdbToRow builds JSON metadata + igdb ids', () => {
  const row = mapIgdbToRow({
    id: 99,
    name: 'Test Game',
    summary: 'Hello',
    cover: { url: '//images.igdb.com/t_thumb/abc.jpg' },
    first_release_date: 1609459200,
    total_rating: 80,
    total_rating_count: 10,
    genres: [{ name: 'RPG' }],
    platforms: [{ name: 'PC' }],
    involved_companies: [
      { publisher: true, company: { name: 'Pub' } },
      { developer: true, company: { name: 'Dev' } }
    ]
  });
  assert.equal(row.game_id, 'igdb_99');
  assert.equal(row.igdb_id, 99);
  assert.equal(row.slug, 'test-game');
  assert.ok(row.background_image.includes('t_cover_big'));
  assert.equal(JSON.parse(row.genres)[0].name, 'RPG');
  assert.equal(JSON.parse(row.publishers)[0].name, 'Pub');
});
