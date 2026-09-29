/* Request/response objects for the shared route modules.

   The handlers in Backend/ were written against Express and use a small,
   known set of members (see docs/cloudflare-migration.md): req.method, url,
   path, params, query, body, headers, get(), protocol, ip; res.status(),
   json(), send(), end(), set(), setHeader(), getHeader(), redirect(),
   statusCode, headersSent, on('finish'). This file implements exactly that
   set on top of the Fetch API, with Express's defaults for content types and
   status codes. Nothing else is emulated. */

const JSON_BODY_LIMIT = 400 * 1024; // express.json({ limit: '400kb' })

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// Express 5's "simple" query parser (node:querystring): repeated keys become
// arrays, and the object has no prototype, so a key like `__proto__` is inert.
function parseQuery(searchParams) {
  const grouped = new Map();
  for (const [key, value] of searchParams) {
    grouped.set(key, grouped.has(key) ? [].concat(grouped.get(key), value) : value);
  }
  return Object.assign(Object.create(null), Object.fromEntries(grouped));
}

function isJson(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  return mime === 'application/json';
}

/* Mirrors express.json(): only application/json is parsed, only when the
   request declares a body, an empty body is {}, and only objects/arrays are
   accepted (strict mode). Otherwise req.body stays undefined. */
async function readJsonBody(request) {
  if (!isJson(request.headers.get('content-type'))) return undefined;
  const length = request.headers.get('content-length');
  const hasBody = request.headers.has('transfer-encoding') || (length !== null && !Number.isNaN(Number(length)));
  if (!hasBody || !request.body) return undefined;
  if (length !== null && Number(length) > JSON_BODY_LIMIT) {
    throw new HttpError(413, 'Request body too large');
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > JSON_BODY_LIMIT) throw new HttpError(413, 'Request body too large');
  const text = new TextDecoder().decode(buffer);
  if (!text.trim()) return {};
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') throw new HttpError(400, 'Invalid JSON body');
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function createRequest(request, url, body) {
  // Header names are already lower-case. fromEntries defines own properties,
  // so a hostile header name cannot reach the prototype.
  const headers = Object.fromEntries(request.headers);
  // Avatar and OAuth callback URLs are built from req.get('host').
  if (!headers.host) headers.host = url.host;

  const req = {
    method: request.method.toUpperCase(),
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    baseUrl: '',
    params: {},
    query: parseQuery(url.searchParams),
    body,
    headers,
    protocol: url.protocol.replace(':', ''),
    secure: url.protocol === 'https:',
    hostname: url.hostname,
    ip: request.headers.get('cf-connecting-ip') || '',
    get(name) {
      const key = String(name).toLowerCase();
      if (key === 'referer' || key === 'referrer') return request.headers.get('referer') || undefined;
      if (key === 'host') return headers.host;
      return request.headers.get(key) ?? undefined;
    }
  };
  req.header = req.get;
  Object.defineProperty(req, 'path', {
    enumerable: true,
    get() { return (this.url || '/').split('?')[0]; }
  });
  return req;
}

/* A response under construction. `done` resolves with a Fetch Response the
   first time the handler ends it (json/send/end/redirect). */
function createResponse(method) {
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const headers = new Map(); // lower-case name -> { name, value }
  const finishListeners = [];

  function build(bodyInit) {
    const out = new Headers();
    for (const { name, value } of headers.values()) {
      if (Array.isArray(value)) value.forEach((v) => out.append(name, String(v)));
      else out.set(name, String(value));
    }
    // HEAD, 204 and 304 carry no body.
    const noBody = method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304;
    return new Response(noBody ? null : bodyInit, { status: res.statusCode, headers: out });
  }

  const res = {
    statusCode: 200,
    headersSent: false,
    done,

    status(code) { res.statusCode = Number(code); return res; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), { name, value }); return res; },
    getHeader(name) { const h = headers.get(String(name).toLowerCase()); return h ? h.value : undefined; },
    removeHeader(name) { headers.delete(String(name).toLowerCase()); return res; },
    set(field, value) {
      if (field && typeof field === 'object') {
        Object.entries(field).forEach(([k, v]) => res.setHeader(k, v));
      } else {
        res.setHeader(field, value);
      }
      return res;
    },
    header(field, value) { return res.set(field, value); },
    on(event, listener) {
      if (event === 'finish') finishListeners.push(listener);
      return res;
    },

    end(chunk) {
      if (res.headersSent) return res;
      res.headersSent = true;
      let body = null;
      if (chunk != null) {
        body = typeof chunk === 'string' ? chunk : (chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      }
      resolveDone(build(body));
      for (const listener of finishListeners) {
        try { listener(); } catch (err) { console.error('finish listener failed:', err && err.message); }
      }
      return res;
    },

    json(value) {
      if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(value));
    },

    send(value) {
      if (value && typeof value === 'object' && !(value instanceof Uint8Array)) return res.json(value);
      if (!res.getHeader('content-type')) {
        res.setHeader('Content-Type', typeof value === 'string' ? 'text/html; charset=utf-8' : 'application/octet-stream');
      }
      return res.end(value == null ? '' : value);
    },

    redirect(statusOrUrl, maybeUrl) {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      const location = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
      res.status(status).setHeader('Location', location);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(`Found. Redirecting to ${location}`);
    }
  };
  return res;
}

module.exports = { createRequest, createResponse, readJsonBody, HttpError, JSON_BODY_LIMIT };
