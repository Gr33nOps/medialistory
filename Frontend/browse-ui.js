/* Shared browse presentation. Filter summaries adapt 21st.dev's Filter Token
   Bar pattern to native selects and MediaListory's existing request handlers. */
(function () {
  'use strict';
  var byId = function (id) { return document.getElementById(id); };
  var results = byId('searchResults');
  var panel = byId('filterSection');
  var trigger = byId('filterBtn');
  var input = byId('searchInput');
  if (!results || !panel || !trigger || !input) return;

  var labels = { genre: 'Genre', platform: 'Platform', gameMode: 'Game mode', year: 'Year', minRating: 'Minimum rating', runtime: 'Runtime', language: 'Language', statusFilter: 'Status', typeFilter: 'Type', season: 'Season', subtype: 'Format', ageRating: 'Age rating' };
  var fields = Array.from(panel.querySelectorAll('select'));
  fields.forEach(function (select) {
    var label = document.createElement('label');
    label.className = 'browse-filter-field';
    label.htmlFor = select.id;
    var text = document.createElement('span');
    text.textContent = labels[select.id] || 'Filter';
    select.before(label);
    label.append(text, select);
  });
  panel.setAttribute('aria-label', 'Browse filters');
  trigger.setAttribute('aria-controls', panel.id);
  function syncPanel() {
    trigger.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
  }
  new MutationObserver(syncPanel).observe(panel, { attributes: true, attributeFilter: ['class'] });
  syncPanel();
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { panel.classList.add('hidden'); trigger.focus(); }
  });

  var summary = document.createElement('div');
  summary.className = 'browse-summary';
  summary.innerHTML = '<p class="browse-result-count" role="status" aria-live="polite"></p><div class="browse-tokens" role="group" aria-label="Active filters"></div>';
  results.before(summary);
  var count = summary.querySelector('p');
  var tokens = summary.querySelector('.browse-tokens');
  var applied = [];
  function renderTokens() {
    tokens.replaceChildren();
    applied.forEach(function (filter) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'browse-token';
      button.textContent = filter.label + ': ' + filter.text + ' ×';
      button.setAttribute('aria-label', 'Remove ' + filter.label.toLowerCase() + ' filter: ' + filter.text);
      button.addEventListener('click', function () {
        // Keep uncommitted changes in the panel from being applied accidentally.
        fields.forEach(function (field) {
          var saved = applied.find(function (f) { return f.id === field.id; });
          field.value = saved && saved.id !== filter.id ? saved.value : '';
        });
        byId('applyFiltersBtn').click();
        trigger.focus();
      });
      tokens.append(button);
    });
    trigger.textContent = applied.length ? 'Filters (' + applied.length + ')' : 'Filters';
  }
  byId('applyFiltersBtn').addEventListener('click', function () {
    applied = fields.filter(function (f) { return f.value; }).map(function (f) {
      return { id: f.id, value: f.value, label: labels[f.id] || 'Filter', text: f.selectedOptions[0].textContent };
    });
    renderTokens();
    panel.classList.add('hidden');
    trigger.focus();
  });
  byId('resetFiltersBtn').addEventListener('click', function () { applied = []; renderTokens(); });

  input.type = 'search';
  input.setAttribute('enterkeyhint', 'search');
  var clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'browse-clear link-btn';
  clear.textContent = 'Clear search';
  clear.hidden = true;
  summary.append(clear);
  input.addEventListener('input', function () { clear.hidden = !input.value; });
  clear.addEventListener('click', function () {
    input.value = '';
    clear.hidden = true;
    byId('searchBtn').click();
    input.focus();
  });

  function updateResults() {
    var busy = !!results.querySelector('.skeleton-card');
    results.setAttribute('aria-busy', String(busy));
    var size = results.querySelectorAll('.game-card').length;
    count.textContent = busy ? 'Loading titles…' : size ? size + ' titles · ' + (byId('pageInfo').textContent || 'Page 1') : '';
    var empty = results.querySelector('.empty-state');
    if (empty && !empty.querySelector('button')) {
      var message = empty.textContent;
      var noMatches = /^No .*found/i.test(message);
      empty.replaceChildren();
      var title = document.createElement('h2');
      title.textContent = noMatches ? 'No matching titles' : 'Unable to load titles';
      var description = document.createElement('p');
      description.textContent = noMatches ? message + ' Try a different title or fewer filters.' : message;
      var action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-secondary';
      action.textContent = noMatches ? 'Reset search and filters' : 'Try again';
      action.addEventListener('click', function () {
        if (!noMatches && typeof window.__retryBrowse === 'function') { window.__retryBrowse(); return; }
        if (noMatches) {
          input.value = '';
          clear.hidden = true;
          fields.forEach(function (field) { field.value = ''; });
          applied = []; renderTokens();
          byId('resetFiltersBtn').click();
        }
        byId('searchBtn').click();
      });
      empty.append(title, description, action);
    }
  }
  // Only observe direct result replacement; enriching an empty state won't loop.
  new MutationObserver(updateResults).observe(results, { childList: true });
  updateResults();
})();
