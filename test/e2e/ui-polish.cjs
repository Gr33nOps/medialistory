// Isolated UI verification; every API request is fulfilled locally. No account
// or library data is written. Run with Playwright available in NODE_PATH:
// node test/e2e/ui-polish.cjs (start the local app first).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.BASE_URL || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Use a local server for this verification.');
const output = process.env.UI_SCREENSHOTS;
const poster = '/img/no-image.svg';
const user = { id: 1, username: 'mediafan', display_name: 'Alex Rivera', email: 'alex@example.test', created_at: '2024-01-01', avatar_url: poster, is_private: false };
const titles = Array.from({ length: 24 }, (_, i) => ({ id: 'tmdb_movie_' + (i + 1), name: i ? 'A Journey Beyond the Stars ' + (i + 1) : 'The Extraordinary Adventures of a Very Long Movie Title', background_image: poster, released: '2024-01-12', rating: 4.2, media_type: 'movie', description: 'A thoughtful journey through unfamiliar worlds. '.repeat(14), genres: [{ name: 'Adventure' }], runtime: 124, provider_id: i + 1, provider: 'tmdb' }));
const games = titles.map((t, i) => ({ ...t, game_id: i + 1, media_ref: t.id, status: ['playing', 'completed', 'plan_to_play'][i % 3], score: 8, note: 'A memorable story.', updated_at: '2026-09-01', added_at: '2026-08-01' }));
const igdb = titles.map((t, i) => ({ id: i + 1, name: t.name, first_release_date: 1700000000, rating: 84, summary: t.description, genres: t.genres }));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], checks = [];
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ user }) => {
      localStorage.setItem('authToken', 'ui-test-token');
      localStorage.setItem('currentUser', JSON.stringify(user));
      window.MGL_SENTRY_DSN = '';
    }, { user });
    let empty = false, failure = false, delay = false, signedIn = true, followed = false;
    const people = [{ id: 2, username: 'storyseeker', display_name: 'Morgan Chen', avatar_url: poster, is_private: false }, { id: 3, username: 'sam', display_name: 'Sam Rivera', avatar_url: poster, is_private: true }];
    const queries = [];
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/') && !['/health', '/ready'].includes(url.pathname)) return route.continue();
      const p = url.pathname.replace(/^\/api/, '');
      const payload = req.postDataJSON() || {};
      let data = {}, status = 200, headers = {};
      if (p === '/auth/session') { data = signedIn ? { token: 'ui-test-token', user } : {}; status = signedIn ? 200 : 401; }
      else if (p === '/auth/me' || p === '/user/profile') data = { user };
      else if (p === '/user/games') data = req.method() === 'GET' ? { games } : { success: true, id: 100 };
      else if (p === '/user/games/refs') data = [{ ref: titles[0].id, id: 1, status: 'completed', score: 8 }];
      else if (p === '/user/profile/top') data = { top: {}, current: [] };
      else if (p === '/user/lists') data = { lists: [{ id: 1, name: 'Weekend favourites', category: 'movie', description: 'Something worth watching again.', game_count: 8, is_public: true, cover_images: [poster, poster, poster] }] };
      else if (/\/lists\/1/.test(p)) data = { list: { id: 1, name: 'Weekend favourites', games: games.slice(0, 8) } };
      else if (p === '/users/2') data = { user: { ...user, id: 2, canView: true, display_name: 'AlexandertheGreatWithAnExceptionallyLongUnbrokenName' }, top: {}, current: [] };
      else if (p === '/users/2/games') data = { games };
      else if (p === '/users/2/lists') data = { lists: [] };
      else if (/\/genres$|\/platforms$|\/game_modes$/.test(p)) data = [{ id: 1, name: 'Adventure' }, { id: 2, name: 'Drama' }];
      else if (p === '/tmdb/languages') data = [{ code: 'en', name: 'English' }];
      else if (/^\/(tmdb\/(movies|series)|kitsu\/anime|igdb\/games)$/.test(p)) {
        queries.push(payload);
        if (delay && payload.search === 'old query') await new Promise(r => setTimeout(r, 900));
        status = failure ? 503 : 200;
        if (failure) data = { error: 'Temporarily unavailable' };
        else if (empty) data = [];
        else if (payload.search === 'sort check') {
          const names = ['Zulu Result', 'Alpha Result', 'Middle Result'];
          data = (p === '/igdb/games' ? igdb : titles).slice(0, 3).map((item, i) => ({
            ...item,
            name: names[i],
            rating: [1, 5, 3][i],
            total_rating: [20, 100, 60][i],
            total_rating_count: 10
          }));
        } else data = p === '/igdb/games' ? igdb : titles.map(t => ({ ...t, name: payload.search || t.name }));
        headers = { 'X-Has-More': '1', 'X-Sort-State': payload.search ? 'unavailable' : 'applied', 'X-Filters-Applied': payload.search ? '0' : '1' };
      } else if (p === '/people') data = { name: 'Alex Morgan', kind: 'person', image: poster, summary: titles[0].description, facts: [{ label: 'Known for', value: 'Acting' }], credits: titles.map(t => ({ ...t, ref: t.id })) };
      else if (p === '/followers' || p === '/users/2/followers') data = { followers: people };
      else if (p === '/following') data = { following: followed ? [{ ...people[0], relationship: 'following' }] : [] };
      else if (p === '/follow/2') { followed = req.method() === 'POST'; data = { status: followed ? 'following' : 'none' }; }
      else if (p === '/following/activity') data = { activity: [] };
      else if (p === '/follow/requests') data = { requests: [] };
      else if (p === '/discover/similar') data = { users: people.map(p => ({ ...p, similarity: { percent: 72, shared: 5, coRated: 4, topShared: 1 } })) };
      else if (p.startsWith('/discover') || p === '/users/search') data = { users: people.map(p => ({ ...p, relationship: p.id === 2 && followed ? 'following' : 'none' })) };
      else if (p.endsWith('/seasons')) data = { seasons: [] };
      await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    async function fit(label) {
      const issue = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      if (issue.scroll > issue.width + 1) {
        console.log(await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1 || el.scrollWidth > el.clientWidth + 2); }).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width, scroll: el.scrollWidth, overflow: getComputedStyle(el).overflow })).slice(0, 40)));
        await shot('overflow');
      }
      assert(issue.scroll <= issue.width + 1, label + ' overflows: ' + JSON.stringify(issue));
      checks.push(label);
    }
    async function shot(label) {
      if (output) { fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, label + '.png'), animations: 'disabled' }); }
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['movies.html', 'series.html', 'anime.html', 'home.html']) {
        await page.goto(base + '/' + route);
        await page.locator('.game-title-link').first().waitFor();
        await fit(route + ' ' + width);
        const ratio = await page.locator('.game-image-wrapper').first().evaluate(el => el.clientWidth / el.clientHeight);
        assert(Math.abs(ratio - 2 / 3) < .015, 'Poster ratio');
        await page.locator('#filterBtn').click();
        await page.locator('#genre').selectOption('Adventure');
        await fit('filters ' + route + ' ' + width);
        await page.locator('#applyFiltersBtn').click();
        await page.locator('.browse-token').waitFor();
        assert.equal(await page.locator('#filterBtn').getAttribute('aria-expanded'), 'false');
        await page.locator('.browse-token').click();
        assert.equal(await page.locator('.browse-token').count(), 0);
        await page.locator('.game-title-link').first().waitFor();
        await page.locator('.card-quick-add').first().click();
        await page.locator('.quick-add-panel').waitFor();
        await fit('quick add ' + route + ' ' + width);
        const box = await page.locator('.quick-add-panel').boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width + 1, 'Quick add fits');
        await page.locator('.quick-add-panel [role="slider"]').focus();
        await page.keyboard.press('End');
        assert.equal(await page.locator('#qaScore').inputValue(), '10');
        await page.locator('.quick-add-panel .score-meter-clear').click();
        assert.equal(await page.locator('#qaScore').inputValue(), '');
        await shot('quick-add-' + route.split('.')[0] + '-' + width);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.quick-add-panel').count(), 0);
      }
      for (const route of ['dashboard.html', 'library.html', 'profile.html', 'userProfile.html?userId=2', 'friends.html', 'title.html?ref=tmdb_movie_1', 'title.html?ref=tmdb_series_1', 'title.html?ref=kitsu_1', 'title.html?ref=igdb_1', 'person.html?ref=tmdb_person_1', 'auth.html', 'about.html', 'privacy.html', 'terms.html', '404.html']) {
        signedIn = route !== 'auth.html';
        await page.goto(base + '/' + route);
        await page.waitForLoadState('networkidle');
        await fit(route + ' ' + width);
        if (['library.html', 'profile.html', 'title.html?ref=tmdb_movie_1', 'dashboard.html'].includes(route)) await shot(route.split('.')[0] + '-' + width);
        if (route === 'profile.html') {
          await page.locator('[data-connections="followers"]').click();
          await page.locator('.connection-person').first().waitFor();
          await page.locator('#connectionsSearch').fill('morgan');
          assert.equal(await page.locator('.connection-person').count(), 1);
          await fit('followers dialog ' + width);
          await shot('followers-' + width);
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('[data-connections="followers"]').evaluate(el => el === document.activeElement), true);
          await page.locator('#editProfileBtn').click();
          await fit('profile edit ' + width);
          await shot('profile-edit-' + width);
        }
        if (route === 'library.html') {
          if (width <= 600) {
            const categoryWidths = await page.locator('.media-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().width));
            assert(Math.max(...categoryWidths) - Math.min(...categoryWidths) < 1, 'Library category buttons have equal widths');
            assert.equal(await page.locator('.overview-split').isVisible(), false);
            await page.locator('#overviewToggle').click();
            assert.equal(await page.locator('.overview-split').isVisible(), true);
            await page.locator('#overviewToggle').click();
          }
          await page.locator('#viewToggleBtn').click();
          await fit('library grid ' + width);
          await page.locator('#tabBtnLists').click();
          await fit('custom lists ' + width);
          await shot('custom-lists-' + width);
          await page.locator('.cl-collection-toggle').focus();
          await page.keyboard.press('Enter');
          await page.locator('.cl-list-item').first().waitFor();
          assert.equal(await page.locator('.cl-collection-toggle').getAttribute('aria-expanded'), 'true');
          await fit('expanded collection ' + width);
          await shot('collection-detail-' + width);
          await page.locator('.cl-collection-toggle').click();
          await page.locator('#clNewListBtn').click();
          await page.locator('#clListFormModal').waitFor({ state: 'visible' });
          await page.locator('#clListFormSubmit').focus();
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.id), 'clListFormClose');
          await fit('new list dialog ' + width);
          await shot('new-list-' + width);
          await page.locator('#clListFormCancel').click();
          assert.equal(await page.evaluate(() => document.activeElement.id), 'clNewListBtn');
        }
        if (route === 'friends.html') {
          await shot('people-' + width);
          if (!followed) {
            await page.locator('#discoverList [data-action="follow"][data-user-id="2"]').click();
            await page.locator('#discoverList [data-action="unfollow"][data-user-id="2"]').waitFor();
            assert.equal(await page.locator('#followingCount').textContent(), '1 following');
          }
        }
        if (route.startsWith('title.html')) {
          await page.locator('.desc-toggle').click();
          assert(await page.locator('.desc-full').isVisible());
          await page.locator('.desc-toggle').click();
        }
      }
      await page.goto(base + '/movies.html');
      await page.locator('.game-title-link').first().waitFor();
      await page.locator('#navProfileBtn').focus();
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'navLogoutBtn');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'navProfileBtn');
      await page.locator('#navSearchBtn').click();
      assert(await page.locator('#gsearchClose').isVisible(), 'Search close visible');
      await fit('global search ' + width);
      await shot('search-' + width);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'gsearchClose');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'navSearchBtn');
      await page.locator('#navThemeBtn').evaluate(el => el.click());
      await fit('light browse ' + width);
      await shot('light-browse-' + width);
      await page.locator('#navThemeBtn').evaluate(el => el.click());
    }
    // A slow response must never discard the final search, on either engine.
    for (const route of ['movies.html', 'home.html']) {
      await page.goto(base + '/' + route);
      await page.locator('.game-title-link').first().waitFor();
      delay = true;
      const queryStart = queries.length;
      await page.locator('#searchInput').fill('old query');
      await Promise.all([
        page.waitForRequest(r => r.url().includes('/api/') && (r.postData() || '').includes('old query')),
        page.locator('#searchBtn').click()
      ]);
      await page.locator('#searchInput').fill('new query');
      await page.locator('#searchBtn').click();
      await page.waitForFunction(() => document.querySelector('#searchResults').getAttribute('aria-busy') === 'false');
      assert.equal(queries.slice(queryStart).at(-1).search, 'new query', 'Final search sent');
      delay = false;
    }
    // Searching must preserve the chosen sort and apply it even when an
    // upstream search endpoint only returns relevance ordering.
    for (const route of ['series.html', 'anime.html', 'home.html']) {
      await page.goto(base + '/' + route);
      await page.locator('.game-title-link').first().waitFor();
      await page.locator('#sortBy').selectOption('rating-desc');
      await page.locator('#searchInput').fill('sort check');
      await page.locator('#searchBtn').click();
      await page.locator('.game-title-link').first().waitFor();
      assert.equal(await page.locator('#sortBy').evaluate(el => el.value), 'rating-desc', route + ' keeps the selected sort during search');
      assert.deepEqual(await page.locator('.game-title-link').allTextContents(), ['Alpha Result', 'Middle Result', 'Zulu Result']);
      assert.equal(await page.locator('#sortBy').isEnabled(), true, route + ' keeps sorting available during search');
    }
    // Opening a title must retain the page the visitor was browsing, including
    // when the document reloads after browser Back.
    for (const route of ['movies.html', 'series.html', 'anime.html', 'home.html']) {
      await page.goto(base + '/' + route);
      await page.locator('.game-title-link').first().waitFor();
      await page.locator('#nextPageBtn').click();
      await page.getByText('Page 2', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('page'), '2', route + ' records the active page in its address');
      await Promise.all([
        page.waitForURL('**/title.html?ref=*'),
        page.locator('.game-title-link').first().click()
      ]);
      await page.goBack();
      await page.locator('.game-title-link').first().waitFor();
      assert.equal(await page.locator('#pageInfo').textContent(), 'Page 2', route + ' restores page 2 after Back');
    }
    await page.locator('#navSearchBtn').click();
    delay = true;
    await Promise.all([
      page.waitForRequest(r => (r.postData() || '').includes('old query')),
      page.locator('#gsearchInput').fill('old query')
    ]);
    await page.locator('#gsearchInput').fill('');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.gsearch-item').count(), 0, 'Cleared search stays empty after a slow response');
    delay = false;
    await page.locator('#gsearchInput').fill('Star');
    await page.locator('.gsearch-item').first().waitFor();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#gsearchInput').getAttribute('aria-activedescendant'), 'gsearch-option-0');
    await page.locator('#gsearchClose').click();
    empty = true;
    await page.goto(base + '/movies.html');
    await page.getByRole('button', { name: 'Reset search and filters' }).waitFor();
    await fit('empty state');
    empty = false; failure = true;
    await page.goto(base + '/movies.html');
    await page.getByRole('button', { name: 'Try again' }).waitFor();
    failure = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.locator('.game-title-link').first().waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base + '/dashboard.html');
    assert.equal(await page.locator('.dash-hero').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.deepEqual(errors, [], 'Browser errors');
    console.log(JSON.stringify({ passed: checks.length, errors, checks }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
