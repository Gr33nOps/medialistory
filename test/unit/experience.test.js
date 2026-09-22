const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const frontend = path.join(__dirname, '../../Frontend');

function page(name, query = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(frontend, name + '.html'), 'utf8'), {
    url: 'http://localhost/' + name + '.html' + query, runScripts: 'outside-only'
  });
  const w = dom.window;
  w.ensureSession = () => new Promise(() => {});
  w.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  w.eval(fs.readFileSync(path.join(frontend, name + '.js'), 'utf8'));
  return dom;
}

test('collection links open the collections panel and preserve category filtering', () => {
  const dom = page('library', '?media=movie&tab=lists');
  const w = dom.window;
  w.clLoadLists = () => {};
  w.initPageTabs();
  assert.equal(w.document.querySelector('#tab-lists').hidden, false);
  assert.equal(w.document.querySelector('#tab-collection').hidden, true);
  w.document.querySelector('#tabBtnCollection').click();
  assert.equal(new URL(w.location.href).searchParams.get('media'), 'movie');
  assert.equal(new URL(w.location.href).searchParams.get('tab'), 'collection');
  dom.window.close();
});

test('collections expose a keyboard-operable disclosure with an accessible name', () => {
  const dom = page('library');
  const w = dom.window;
  w.document.querySelector('#clAccordion').innerHTML = w.clRenderAccordionRow({ id: 7, name: 'Weekend picks', game_count: 2, cover_images: ['/img/no-image.svg'] });
  const toggle = w.document.querySelector('.cl-acc-header button[aria-expanded]');
  assert.ok(toggle, 'Collection must have a native disclosure button');
  assert.match(toggle.textContent, /Weekend picks/);
  assert.equal(toggle.getAttribute('aria-controls'), 'cl-acc-body-7');
  dom.window.close();
});

test('follow shows progress, then confirms the relationship before background refresh', async () => {
  const dom = page('friends');
  const w = dom.window;
  let resolve;
  w.fetch = () => new Promise(r => { resolve = r; });
  w.refreshAll = () => new Promise(() => {});
  w.document.querySelector('#discoverList').innerHTML = w.renderUserCard({ id: 2, username: 'alex' });
  const btn = w.document.querySelector('[data-action="follow"]');
  void w.handleFollow('2', btn);
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  assert.match(btn.textContent, /Following/);
  resolve({ ok: true, json: async () => ({ status: 'following' }) });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(btn.dataset.action, 'unfollow');
  assert.equal(btn.disabled, false);
  assert.equal(btn.getAttribute('aria-busy'), null);
  dom.window.close();
});

test('failed follow restores the action and announces a retryable error', async () => {
  const dom = page('friends');
  const w = dom.window;
  const messages = [];
  w.toast = (message, type) => messages.push({ message, type });
  w.fetch = async () => { throw new Error('offline'); };
  w.document.querySelector('#discoverList').innerHTML = w.renderUserCard({ id: 2, username: 'alex' });
  const btn = w.document.querySelector('[data-action="follow"]');
  await w.handleFollow('2', btn);
  assert.equal(btn.disabled, false);
  assert.equal(btn.dataset.action, 'follow');
  assert.equal(messages.at(-1)?.type, 'error');
  dom.window.close();
});

async function enhancedPage(name, query = '') {
  const dom = page(name, query);
  const w = dom.window;
  w.getToken = () => 'test';
  w.getStoredUser = () => ({ id: 1 });
  w.openModal = id => { w.document.getElementById(id).style.display = 'flex'; };
  w.closeModal = id => { w.document.getElementById(id).style.display = 'none'; };
  w.bindModal = () => {};
  const file = path.join(frontend, 'experience.js');
  if (fs.existsSync(file)) w.eval(fs.readFileSync(file, 'utf8'));
  await new Promise(r => setTimeout(r, 0));
  return dom;
}

test('mobile navigation keeps one Library destination without a duplicate Collections item', async () => {
  const dom = await enhancedPage('library', '?tab=lists');
  const dockLinks = dom.window.document.querySelectorAll('.mobile-dock a');
  const library = dom.window.document.querySelector('.mobile-dock a[href="library.html"]');
  assert.equal(dockLinks.length, 4);
  assert.equal(dom.window.document.querySelector('.mobile-dock a[href="library.html?tab=lists"]'), null);
  assert.equal(library.getAttribute('aria-current'), 'page');
  dom.window.close();
});

test('profile followers open a searchable list with links to real profiles', async () => {
  const dom = await enhancedPage('profile');
  const w = dom.window;
  w.apiFetch = async route => {
    assert.equal(route, '/followers');
    return { ok: true, json: async () => ({ followers: [{ id: 2, username: 'alex', display_name: 'Alex' }, { id: 3, username: 'sam', display_name: 'Sam' }] }) };
  };
  const button = w.document.querySelector('button[data-connections="followers"]');
  assert.ok(button, 'Follower count must open its list');
  button.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(w.document.querySelectorAll('.connection-person').length, 2);
  const search = w.document.querySelector('#connectionsSearch');
  search.value = 'alex'; search.dispatchEvent(new w.Event('input'));
  assert.equal(w.document.querySelectorAll('.connection-person').length, 1);
  assert.equal(w.document.querySelector('.connection-person').getAttribute('href'), 'userProfile.html?userId=2');
  dom.window.close();
});

test('public collections have native disclosure controls', () => {
  const dom = page('userProfile', '?userId=2');
  const w = dom.window;
  w.document.querySelector('#upAccordion').innerHTML = w.upRenderAccordionRow({ id: 7, name: 'Weekend picks', game_count: 2 });
  const toggle = w.document.querySelector('.up-acc-header button[aria-expanded]');
  assert.ok(toggle, 'Public collections must work with a keyboard');
  assert.equal(toggle.getAttribute('aria-controls'), 'up-acc-body-7');
  dom.window.close();
});

test('profile follow prevents duplicate requests and updates immediately after success', async () => {
  const dom = page('userProfile', '?userId=2');
  const w = dom.window;
  let resolve, calls = 0;
  w.fetch = () => { calls++; return new Promise(r => { resolve = r; }); };
  w.loadUserProfile = () => new Promise(() => {});
  const btn = w.document.querySelector('#followActionBtn');
  void w.followUser();
  void w.followUser();
  assert.equal(calls, 1);
  assert.equal(btn.disabled, true);
  resolve({ ok: true, json: async () => ({ status: 'following' }) });
  await new Promise(r => setTimeout(r, 0));
  assert.match(btn.textContent, /Following/);
  assert.equal(btn.disabled, false);
  dom.window.close();
});

test('title rendering treats catalog strings as text even without the shared escape helper', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(frontend, 'title.html'), 'utf8'), {
    url: 'http://localhost/title.html?ref=tmdb_movie_1', runScripts: 'outside-only'
  });
  const w = dom.window;
  const name = '<img src=x onerror="alert(1)"> & a "story"';
  w.apiFetch = async () => ({ ok: true, json: async () => [{ id: 'tmdb_movie_1', name, rating: 4, released: '2024-01-01', description: '<b>Plain text</b>', genres: [] }] });
  w.eval(fs.readFileSync(path.join(frontend, 'title.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(w.document.querySelector('.game-detail-title').textContent, name);
  assert.equal(w.document.querySelector('.game-detail-title img'), null);
  assert.equal(w.document.querySelector('.title-hero-poster').getAttribute('alt'), name + ' cover');
  dom.window.close();
});

test('profile showcase links prefer provider references over internal library IDs', () => {
  const dom = page('profile');
  const w = dom.window;
  const html = w.mgShowcase([{ game_id: 33764, media_ref: 'igdb_119161', name: 'Need for Speed: Heat' }], 'Empty');
  const host = w.document.createElement('div'); host.innerHTML = html;
  assert.equal(host.querySelector('a').getAttribute('href'), 'title.html?ref=igdb_119161');
  host.innerHTML = w.mgShowcase([{ game_id: 'tmdb_movie_550', name: 'Fight Club' }], 'Empty');
  assert.equal(host.querySelector('a').getAttribute('href'), 'title.html?ref=tmdb_movie_550');
  dom.window.close();
});
