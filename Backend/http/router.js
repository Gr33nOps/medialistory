/* A small router with the slice of Express's Router API the route modules use.

   The route modules were written against express.Router(). Rather than rewrite
   ~170 handlers for a new framework, they build on this instead, which runs
   the same handlers in two places:

     - on Node, a Router is ordinary connect-style middleware, so Express can
       still mount it (Backend/server.js);
     - on Cloudflare Workers, worker/index.js feeds it request/response objects
       that expose the same members (worker/http.js).

   Supported: use([path], ...fns), get/post/put/patch/delete/all(path, ...fns),
   `:param` segments, nested routers, next(err), async handlers (a rejected
   promise becomes next(err), as in Express 5), and HEAD answered by GET routes.
   Matching is case-insensitive and ignores a trailing slash, like Express. */

const { background } = require('../runtime');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// '/lists/:listId/games' -> /^\/lists\/([^/]+?)\/games\/?$/i with keys ['listId'].
function compile(path, end) {
  const keys = [];
  const trimmed = path === '/' ? '' : String(path).replace(/\/$/, '');
  const source = trimmed.split('/').map((segment) => {
    if (segment.startsWith(':')) {
      keys.push(segment.slice(1));
      return '([^/]+?)';
    }
    return escapeRegExp(segment);
  }).join('/');
  /* Paths come from route definitions in code, never from a request, and
     every literal segment is escaped above; the only pattern is [^/]+?. */
  const regexp = end
    ? new RegExp(`^${source}\\/?$`, 'i') // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    : new RegExp(`^${source}(?=\\/|$)`, 'i'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return { regexp, keys };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function splitUrl(url) {
  const q = url.indexOf('?');
  return q === -1 ? [url, ''] : [url.slice(0, q), url.slice(q)];
}

// Run a handler; a thrown error or rejected promise is passed to next().
// An async handler can keep working after it has answered, so on Workers its
// promise is registered as background work to keep the request alive.
function invoke(fn, args, next) {
  try {
    const result = fn(...args);
    if (result && typeof result.then === 'function') {
      result.then(undefined, (err) => next(err || new Error('Rejected without a reason')));
      background(result);
    }
  } catch (err) {
    next(err);
  }
}

function Router() {
  const stack = [];

  function router(req, res, out) {
    router.handle(req, res, out);
  }

  function addLayer(method, path, fns, end) {
    const handlers = fns.flat();
    if (!handlers.length || handlers.some((f) => typeof f !== 'function')) {
      throw new TypeError(`Router.${method || 'use'}() requires handler functions`);
    }
    const { regexp, keys } = compile(path, end);
    stack.push({ method, path, regexp, keys, handlers, end });
  }

  router.use = (first, ...rest) => {
    if (typeof first === 'string') addLayer(null, first, rest, false);
    else addLayer(null, '/', [first, ...rest], false);
    return router;
  };

  for (const method of METHODS.concat('all')) {
    router[method] = (path, ...fns) => {
      addLayer(method === 'all' ? '*' : method.toUpperCase(), path, fns, true);
      return router;
    };
  }

  router.handle = (req, res, out) => {
    const done = typeof out === 'function' ? out : () => {};
    const originalUrl = req.url;
    const originalBase = req.baseUrl || '';
    const originalParams = req.params;
    let index = 0;

    function restore() {
      req.url = originalUrl;
      req.baseUrl = originalBase;
      req.params = originalParams;
    }

    function next(err) {
      restore();
      if (res.headersSent && !err) return undefined;
      const [pathname] = splitUrl(req.url || '/');

      while (index < stack.length) {
        const layer = stack[index++];
        const match = layer.regexp.exec(pathname);
        if (!match) continue;

        if (layer.end) {
          const methodOk = layer.method === '*' || layer.method === req.method ||
            (req.method === 'HEAD' && layer.method === 'GET');
          if (!methodOk) continue;
        }

        const params = {};
        layer.keys.forEach((key, i) => { params[key] = decode(match[i + 1]); });

        // Route-level error handlers are not used by this codebase, so an error
        // skips straight to the caller.
        if (err) continue;

        return runLayer(layer, match[0], params);
      }

      return done(err);
    }

    function runLayer(layer, matched, params) {
      let i = 0;
      const step = (err) => {
        if (err) return next(err);
        const fn = layer.handlers[i++];
        if (!fn) return next();

        req.params = { ...(originalParams || {}), ...params };
        if (!layer.end) {
          // Mounted middleware and sub-routers see the path below the mount,
          // with the stripped prefix moved onto baseUrl, as in Express.
          const [pathname, query] = splitUrl(originalUrl || '/');
          const rest = pathname.slice(matched.length) || '/';
          req.baseUrl = originalBase + matched.replace(/\/$/, '');
          req.url = (rest.startsWith('/') ? rest : `/${rest}`) + query;
        } else {
          req.url = originalUrl;
          req.baseUrl = originalBase;
        }
        return invoke(fn, [req, res, step], step);
      };
      return step();
    }

    next();
  };

  return router;
}

module.exports = { Router };
