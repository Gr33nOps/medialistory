(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MGLTransfer = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function text(value) { return value == null ? '' : String(value); }
  function header(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function number(value) {
    if (value == null || value === '') return null;
    var n = Number(text(value).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function year(value) {
    var match = /(?:19|20)\d{2}/.exec(text(value));
    return match ? Number(match[0]) : null;
  }
  function normType(value, fallback) {
    var v = text(value).toLowerCase();
    if (/anime/.test(v)) return 'anime';
    if (/game/.test(v)) return 'game';
    if (/show|series|tvseries|tvmini|television|episode/.test(v)) return 'series';
    if (/film|movie|video/.test(v)) return 'movie';
    return fallback && fallback !== 'auto' ? fallback : 'movie';
  }
  function normStatus(value, fallback) {
    var v = text(value).trim().toLowerCase();
    if (/complet|watched|finish|played|seen/.test(v)) return 'completed';
    if (/watching|playing|current|progress/.test(v)) return 'playing';
    if (/hold|paus/.test(v)) return 'on_hold';
    if (/drop/.test(v)) return 'dropped';
    if (/plan|watchlist|want|backlog|wish/.test(v)) return 'plan_to_play';
    return fallback || 'plan_to_play';
  }
  function score(value, scale) {
    var n = number(value);
    if (n == null) return null;
    var out = scale === 100 ? Math.round(n / 10) : scale === 5 ? Math.round(n * 2) : Math.round(n);
    return Math.max(1, Math.min(10, out));
  }

  function parseCSV(input) {
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < input.length; i++) {
      var c = input[i];
      if (quoted) {
        if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return text(v).trim(); }); });
  }

  function decodeXml(value) {
    return text(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function xmlValue(block, tag) {
    var match = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(block);
    return match ? decodeXml(match[1].trim()) : '';
  }
  function parseMalXml(input) {
    var rows = [], match, re = /<anime(?:\s[^>]*)?>([\s\S]*?)<\/anime>/gi;
    while ((match = re.exec(input))) {
      var block = match[1], title = xmlValue(block, 'series_title');
      if (!title) continue;
      rows.push({
        title: title,
        type: 'anime',
        status: normStatus(xmlValue(block, 'my_status')),
        score: score(xmlValue(block, 'my_score'), 10),
        progress: number(xmlValue(block, 'my_watched_episodes')) || 0,
        externalId: xmlValue(block, 'series_animedb_id') || undefined
      });
    }
    return rows;
  }

  function parseCsvImport(input, defaultType) {
    var raw = parseCSV(input);
    if (raw.length < 2) return [];
    var keys = raw[0].map(header), map = {};
    keys.forEach(function (key, index) { if (map[key] == null) map[key] = index; });
    function pick(cols, names) {
      for (var i = 0; i < names.length; i++) if (map[names[i]] != null) return cols[map[names[i]]];
      return '';
    }
    var isLetterboxd = map.letterboxduri != null || (map.name != null && map.rating != null && map.date != null);
    var isImdb = map.const != null || map.yourrating != null || map.titletype != null;
    var explicitRating10 = map.rating10 != null || map.yourrating != null || map.myrating != null;
    var values = raw.slice(1).map(function (cols) {
      return number(pick(cols, ['score', 'rating10', 'yourrating', 'myrating', 'rating']));
    }).filter(function (v) { return v != null; });
    var max = values.length ? Math.max.apply(Math, values) : 0;
    var guessedScale = explicitRating10 ? 10 : (isLetterboxd ? 5 : (max > 10 ? 100 : max > 5 ? 10 : 5));

    return raw.slice(1).map(function (cols) {
      var title = text(pick(cols, ['title', 'name', 'seriestitle'])).trim();
      if (!title) return null;
      var statusText = pick(cols, ['status', 'state', 'mystatus']);
      var hasActivity = isLetterboxd || isImdb || !!pick(cols, ['watcheddate', 'daterated']);
      var typeText = pick(cols, ['type', 'category', 'mediatype', 'titletype']);
      var rawYear = pick(cols, ['year', 'releaseyear', 'startyear']);
      var row = {
        title: title,
        type: defaultType && defaultType !== 'auto' ? defaultType : normType(typeText, isLetterboxd || isImdb ? 'movie' : 'movie'),
        status: normStatus(statusText, hasActivity ? 'completed' : 'plan_to_play'),
        score: score(pick(cols, ['score', 'rating10', 'yourrating', 'myrating', 'rating']), guessedScale)
      };
      var y = year(rawYear); if (y) row.year = y;
      var progress = number(pick(cols, ['progress', 'episodeswatched', 'watchedepisodes'])); if (progress != null) row.progress = progress;
      var ref = pick(cols, ['ref', 'gameid']); if (ref) row.ref = ref;
      return row;
    }).filter(Boolean);
  }

  function parseJsonImport(value, defaultType) {
    var rows = [];
    function add(entry, forcedType) {
      if (!entry) return;
      var nested = entry.movie || entry.show || entry.episode || entry.game || entry.anime;
      var source = nested || entry;
      var title = source.title || source.name;
      if (!title) return;
      var inferred = forcedType || (entry.movie ? 'movie' : entry.show || entry.episode ? 'series' : entry.game ? 'game' : entry.anime ? 'anime' : source.media_type || source.type);
      var activity = entry.rated_at || entry.watched_at || entry.last_watched_at;
      var progress = number(entry.progress != null ? entry.progress : source.progress);
      var row = {
        title: title,
        type: defaultType && defaultType !== 'auto' ? defaultType : normType(inferred, 'movie'),
        status: normStatus(entry.status != null ? entry.status : source.status, activity || entry.rating != null ? 'completed' : progress ? 'playing' : 'plan_to_play'),
        score: score(entry.rating != null ? entry.rating : (entry.score != null ? entry.score : source.score), 10)
      };
      var y = year(source.year || source.released); if (y) row.year = y;
      if (progress != null) row.progress = progress;
      if (source.game_id) row.ref = source.game_id;
      if (source.progress_hours != null) row.progress_hours = number(source.progress_hours);
      if (source.notes != null) row.notes = text(source.notes);
      rows.push(row);
    }
    if (Array.isArray(value)) value.forEach(function (entry) { add(entry); });
    else if (value && Array.isArray(value.collection)) value.collection.forEach(function (entry) { add(entry); });
    if (value && Array.isArray(value.custom_lists)) value.custom_lists.forEach(function (list) {
      (list.games || []).forEach(function (entry) { add(entry); });
    });
    return rows;
  }

  function parseImport(input, defaultType) {
    var value = text(input).trim();
    if (!value) return [];
    if (/^<\?xml|<myanimelist|<anime[\s>]/i.test(value)) return parseMalXml(value);
    if (value[0] === '{' || value[0] === '[') return parseJsonImport(JSON.parse(value), defaultType || 'auto');
    return parseCsvImport(value, defaultType || 'auto');
  }

  function csv(value) {
    var out = text(value);
    return /[",\r\n]/.test(out) ? '"' + out.replace(/"/g, '""') + '"' : out;
  }
  function xml(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function date(value) { return text(value).slice(0, 10); }
  function providerId(row) { return row.tmdb_id || row.igdb_id || row.provider_id || ''; }
  function collection(backup) { return backup && Array.isArray(backup.collection) ? backup.collection : []; }

  function buildLetterboxd(backup) {
    var lines = ['tmdbID,Title,Year,Rating10,WatchedDate,Review'];
    collection(backup).filter(function (row) { return row.media_type === 'movie'; }).forEach(function (row) {
      lines.push([row.tmdb_id || '', row.name, year(row.released) || '', row.score || '',
        row.status === 'completed' ? date(row.updated_at || row.created_at) : '', row.notes || ''].map(csv).join(','));
    });
    return { filename: 'medialistory-letterboxd-movies.csv', type: 'text/csv;charset=utf-8', text: lines.join('\r\n') };
  }
  function malStatus(value) {
    return { completed: 'Completed', playing: 'Watching', on_hold: 'On-Hold', dropped: 'Dropped', plan_to_play: 'Plan to Watch' }[value] || 'Plan to Watch';
  }
  function buildMal(backup) {
    var anime = collection(backup).filter(function (row) { return row.media_type === 'anime'; });
    var body = anime.map(function (row) {
      return '  <anime>\n' +
        '    <series_animedb_id>' + xml(row.mal_id || 0) + '</series_animedb_id>\n' +
        '    <series_title>' + xml(row.name) + '</series_title>\n' +
        '    <series_type>TV</series_type>\n' +
        '    <series_episodes>' + xml(row.episode_count || 0) + '</series_episodes>\n' +
        '    <my_watched_episodes>' + xml(row.progress || 0) + '</my_watched_episodes>\n' +
        '    <my_score>' + xml(row.score || 0) + '</my_score>\n' +
        '    <my_status>' + malStatus(row.status) + '</my_status>\n' +
        '  </anime>';
    }).join('\n');
    var output = '<?xml version="1.0" encoding="UTF-8"?>\n<myanimelist>\n' + body + '\n</myanimelist>\n';
    return { filename: 'medialistory-myanimelist-anime.xml', type: 'application/xml;charset=utf-8', text: output };
  }
  function buildPortable(backup) {
    var lines = ['Title,Type,Status,Score,Year,Progress,Progress Hours,Provider ID,Notes'];
    collection(backup).forEach(function (row) {
      lines.push([row.name, row.media_type || 'game', row.status || 'plan_to_play', row.score || '',
        year(row.released) || '', row.progress == null ? '' : row.progress,
        row.progress_hours == null ? '' : row.progress_hours, providerId(row), row.notes || ''].map(csv).join(','));
    });
    return { filename: 'medialistory-portable-library.csv', type: 'text/csv;charset=utf-8', text: lines.join('\r\n') };
  }
  function buildExport(backup, format) {
    if (format === 'letterboxd') return buildLetterboxd(backup);
    if (format === 'myanimelist') return buildMal(backup);
    if (format === 'portable') return buildPortable(backup);
    return { filename: 'medialistory-backup.json', type: 'application/json;charset=utf-8', text: JSON.stringify(backup, null, 2) };
  }

  function buildImportPayload(row, gameData) {
    return {
      game_data: gameData,
      status: row.status,
      score: row.score,
      progress: row.progress,
      progress_hours: row.progress_hours,
      notes: row.notes
    };
  }

  return { parseImport: parseImport, buildExport: buildExport, buildImportPayload: buildImportPayload };
});
