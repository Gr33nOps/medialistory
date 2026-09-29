const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const frontend = path.join(__dirname, '../../Frontend');

test('the production frontend calls the Worker API and has no cold-start panel', () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://medialistory.vercel.app/home.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  const timers = [];
  const requested = [];
  w.fetch = (url) => { requested.push(String(url)); return new Promise(() => {}); };
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.clearTimeout = () => {};
  w.MGL_SENTRY_DSN = 'disabled';
  w.eval(fs.readFileSync(path.join(frontend, 'common.js'), 'utf8'));

  assert.equal(w.API_BASE, 'https://medialistory-api.gr33nops.workers.dev/api');
  assert.equal(typeof w.mountBackendWake, 'undefined');
  assert.equal(typeof w.warmBackendForNavigation, 'undefined');

  void w.apiFetch('/tmdb/movies', { method: 'POST' });
  timers.forEach(t => t.fn());

  assert.deepEqual(requested, ['https://medialistory-api.gr33nops.workers.dev/api/tmdb/movies']);
  assert.equal(w.document.getElementById('backendWake'), null);
  assert.ok(!requested.some(u => /\/health$/.test(u)), 'no health polling');
  dom.window.close();
});

test('signed-in dashboard welcome box has one library action, not My collections', () => {
  const dom = new JSDOM('<!doctype html><body><section id="dashHero"></section></body>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.API_BASE = '/api';
  w.apiFetch = () => new Promise(() => {});
  w.getToken = () => 'token';
  w.getStoredUser = () => ({ display_name: 'Alex' });
  w.eval(fs.readFileSync(path.join(frontend, 'dashboard.js'), 'utf8'));
  w.renderDashboardHeroForTest(0, { movie: 1, series: 0, anime: 0, game: 0 });

  const actions = [...w.document.querySelectorAll('#dashHero .dash-hero-cta a')];
  assert.equal(actions.length, 1);
  assert.match(actions[0].textContent, /Open my library/);
  assert.doesNotMatch(w.document.getElementById('dashHero').textContent, /My collections/);
  dom.window.close();
});

test('recently verified sessions avoid another auth round trip during page switches', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/library.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  let fetches = 0;
  w.localStorage.setItem('authToken', 'token');
  w.localStorage.setItem('currentUser', JSON.stringify({ id: 7, username: 'alex' }));
  w.localStorage.setItem('mgl:sessionVerifiedAt', String(Date.now()));
  w.fetch = async () => { fetches++; return { ok: true, json: async () => ({}) }; };
  w.MGL_SENTRY_DSN = 'disabled';
  w.eval(fs.readFileSync(path.join(frontend, 'common.js'), 'utf8'));

  const session = await w.ensureSession();
  assert.equal(fetches, 0);
  assert.equal(session.user.id, 7);
  dom.window.close();
});

test('catalog requests reuse a short-lived response when callers opt into caching', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/movies.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  let fetches = 0;
  function response() { return { ok: true, clone: response, json: async () => [{ id: 1 }] }; }
  w.fetch = async () => { fetches++; return response(); };
  w.MGL_SENTRY_DSN = 'disabled';
  w.eval(fs.readFileSync(path.join(frontend, 'common.js'), 'utf8'));
  const options = { method: 'POST', body: '{"search":"arrival"}', mglCacheMs: 60000 };

  await w.apiFetch('/tmdb/movies', options);
  await w.apiFetch('/tmdb/movies', options);

  assert.equal(fetches, 1);
  dom.window.close();
});

test('social sign-in goes straight to the provider, naming it, without waiting on the API', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(frontend, 'auth.html'), 'utf8'), {
    url: 'https://medialistory.vercel.app/auth.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  const fetches = [];
  w.fetch = (url) => { fetches.push(String(url)); return new Promise(() => {}); };
  w.API_BASE = 'https://medialistory-api.gr33nops.workers.dev/api';
  w.eval(fs.readFileSync(path.join(frontend, 'auth.js'), 'utf8'));

  await w.startOAuth('github');

  const status = w.document.getElementById('oauthStatus');
  assert.equal(status.classList.contains('hidden'), false);
  assert.match(status.textContent, /taking you to GitHub/i);
  assert.equal(w.document.getElementById('oauthError').textContent, '');
  assert.ok(!fetches.some(u => /\/health$/.test(u)), 'no wake-up probe before navigating');
  dom.window.close();
});

test('signed-out dashboard offers every media category in the same hero language', () => {
  const dom = new JSDOM('<!doctype html><body><section id="dashHero"></section></body>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.API_BASE = '/api';
  w.apiFetch = () => new Promise(() => {});
  w.getToken = () => '';
  w.getStoredUser = () => null;
  w.eval(fs.readFileSync(path.join(frontend, 'dashboard.js'), 'utf8'));
  w.renderDashboardHeroForTest(0, null);

  const categoryLinks = [...w.document.querySelectorAll('#dashHero .dash-hero-counts a[data-cat]')];
  assert.deepEqual(categoryLinks.map(link => link.dataset.cat), ['movie', 'series', 'anime', 'game']);
  assert.deepEqual(categoryLinks.map(link => link.getAttribute('href')), ['movies.html', 'series.html', 'anime.html', 'home.html']);
  dom.window.close();
});

test('about categories use one four-column row without colored side rails', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(frontend, 'about.html'), 'utf8'), {
    url: 'http://localhost/about.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  const grid = w.document.querySelector('.feature-grid');
  const card = w.document.querySelector('.feature-card');
  const dot = w.document.querySelector('.feature-card .fc-dot');

  assert.equal(w.getComputedStyle(grid).gridTemplateColumns.replaceAll(' ', ''), 'repeat(4,minmax(0,1fr))');
  assert.equal(w.getComputedStyle(card).borderLeftWidth, '0px');
  assert.notEqual(w.getComputedStyle(dot).display, 'none');
  dom.window.close();
});

test('mobile navigation keeps drawer links inactive until the menu is opened', () => {
  const dom = new JSDOM('<!doctype html><body><nav id="appNav" data-active="home" data-brand="MediaListory"></nav></body>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.matchMedia = query => ({
    matches: query === '(max-width: 600px)',
    media: query,
    addEventListener() {},
    removeEventListener() {}
  });
  w.MGL_SENTRY_DSN = 'disabled';
  w.eval(fs.readFileSync(path.join(frontend, 'common.js'), 'utf8'));
  w.mountAppNav();

  const nav = w.document.getElementById('appNav');
  const drawer = nav.querySelector('.nav-primary');
  const toggle = nav.querySelector('#navToggle');
  assert.equal(nav.dataset.auth, 'guest');
  assert.equal(drawer.hasAttribute('inert'), true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');

  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(drawer.hasAttribute('inert'), false);
  assert.equal(drawer.getAttribute('aria-hidden'), 'false');

  toggle.click();
  assert.equal(drawer.hasAttribute('inert'), true);
  dom.window.close();
});
