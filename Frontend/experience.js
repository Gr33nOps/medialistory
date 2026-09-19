/* Shared navigation and profile connections. Uses the existing session,
   modal focus management, and read-only social endpoints. */
(function () {
  'use strict';
  var icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    library: '<rect x="3" y="4" width="5" height="16" rx="1"/><path d="M12 4v16M16 4l5 15"/>',
    collections: '<rect x="7" y="7" width="14" height="14" rx="3"/><path d="M16 3H6a3 3 0 0 0-3 3v10M11 14h6m-3-3v6"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v3"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>'; }

  function init() {
    var nav = document.getElementById('appNav');
    if (!nav) return;
    var active = nav.dataset.active;
    document.body.dataset.page = active || 'home';
    var signedIn = typeof getToken === 'function' && !!getToken();
    var destinations = [
      ['home', 'dashboard.html', 'Home'],
      ['library', 'library.html', 'Library'],
      ['collections', 'library.html?tab=lists', 'Collections'],
      ['people', 'friends.html', 'People'],
      ['profile', signedIn ? 'profile.html' : 'auth.html', signedIn ? 'Profile' : 'Sign in']
    ];
    var dock = document.createElement('nav');
    dock.className = 'mobile-dock';
    dock.setAttribute('aria-label', 'Your space');
    dock.innerHTML = destinations.map(function(d) {
      return '<a href="' + d[1] + '" data-destination="' + d[0] + '">' + icon(d[0]) + '<span>' + d[2] + '</span></a>';
    }).join('');
    document.body.appendChild(dock);
    document.body.classList.add('has-mobile-dock');
    function markDestination(tab) {
      var key = active === 'list' ? (tab === 'lists' ? 'collections' : 'library') : active === 'friends' ? 'people' : active;
      dock.querySelectorAll('a').forEach(function(a) {
        if (a.dataset.destination === key) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      document.querySelectorAll('.space-link').forEach(function(a) {
        if (a.dataset.destination === key) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }
    var right = nav.querySelector('.nav-right');
    if (right && signedIn) {
      var spaces = document.createElement('div');
      spaces.className = 'nav-spaces';
      spaces.innerHTML = destinations.slice(1, 3).map(function(d) { return '<a class="space-link" data-destination="' + d[0] + '" href="' + d[1] + '">' + icon(d[0]) + '<span>' + d[2] + '</span></a>'; }).join('');
      right.prepend(spaces);
    }
    markDestination(new URLSearchParams(location.search).get('tab'));
    document.addEventListener('librarytabchange', function(e) { markDestination(e.detail); });
    initConnections();
  }

  function initConnections() {
    if (!document.querySelector('.profile-stats')) return;
    ['followers', 'following'].forEach(function(kind) {
      var count = document.getElementById(kind + 'Count');
      if (!count) return;
      var old = count.closest('.stat-item');
      if (!old) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = old.className + ' connection-stat';
      button.dataset.connections = kind;
      button.setAttribute('aria-haspopup', 'dialog');
      // Move the existing count node so pending profile requests still update it.
      while (old.firstChild) button.appendChild(old.firstChild);
      old.replaceWith(button);
      button.addEventListener('click', function() { openConnections(kind); });
    });
  }
  var people = [], requestNumber = 0;
  function renderConnections() {
    var search = document.getElementById('connectionsSearch').value.trim().toLowerCase();
    var matches = people.filter(function(p) { return ((p.display_name || '') + ' ' + p.username).toLowerCase().includes(search); });
    document.getElementById('connectionsResults').innerHTML = matches.length ? matches.map(function(p) {
      var name = p.display_name || p.username || 'Member';
      return '<a class="connection-person" href="userProfile.html?userId=' + encodeURIComponent(p.id) + '">' +
        '<span class="connection-avatar">' + (p.avatar_url ? '<img src="' + esc(p.avatar_url) + '" alt="" loading="lazy">' : esc(name.slice(0, 2).toUpperCase())) + '</span>' +
        '<span><strong>' + esc(name) + '</strong><small>@' + esc(p.username) + '</small></span><span class="connection-arrow" aria-hidden="true">↗</span></a>';
    }).join('') : '<div class="connection-empty"><p>' + (search ? 'No matching people. Try another name.' : 'No people here yet. Every connection starts with a shared story.') + '</p><a class="btn btn-secondary" href="friends.html">Discover people</a></div>';
  }
  async function openConnections(kind) {
    var modal = document.getElementById('connectionsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'connectionsModal';
      modal.className = 'cl-modal-overlay';
      modal.innerHTML = '<div class="cl-modal-box connections-box"><button class="cl-modal-close" id="connectionsClose" aria-label="Close people list">×</button>' +
        '<p class="eyebrow">Better together</p><h2 id="connectionsTitle"></h2>' +
        '<label class="sr-only" for="connectionsSearch">Search this list</label><input id="connectionsSearch" class="search-input" type="search" placeholder="Find someone in this list…">' +
        '<div id="connectionsResults" aria-live="polite"></div></div>';
      document.body.appendChild(modal);
      bindModal('connectionsModal', 'connectionsClose');
      modal.setAttribute('aria-labelledby', 'connectionsTitle');
      document.getElementById('connectionsSearch').addEventListener('input', renderConnections);
    }
    var serial = ++requestNumber;
    var results = document.getElementById('connectionsResults');
    document.getElementById('connectionsTitle').textContent = kind === 'followers' ? 'Followers' : 'Following';
    document.getElementById('connectionsSearch').value = '';
    people = [];
    results.innerHTML = '<p class="connection-empty" role="status">Finding your people…</p>';
    openModal('connectionsModal');
    var userId = new URLSearchParams(location.search).get('userId');
    var endpoint = (userId && location.pathname.endsWith('userProfile.html') ? '/users/' + encodeURIComponent(userId) : '') + '/' + kind;
    try {
      var response = await apiFetch(endpoint);
      if (!response.ok) throw new Error('Could not load people');
      var data = await response.json();
      if (serial !== requestNumber) return;
      people = data[kind] || [];
      renderConnections();
    } catch (_) {
      if (serial !== requestNumber) return;
      results.innerHTML = '<div class="connection-empty"><p>Could not load people. Please try again.</p><button class="btn btn-secondary" id="connectionsRetry">Try again</button></div>';
      document.getElementById('connectionsRetry').addEventListener('click', function() { openConnections(kind); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
