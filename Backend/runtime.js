/* Per-request context shared by both runtimes.

   On Cloudflare Workers, worker/index.js runs every request inside
   runWithContext(), which gives the rest of the backend two things it cannot
   get from module scope:

     - background(promise): work that must outlive the response (write-through
       caching) is handed to ctx.waitUntil. Without it the runtime cancels the
       write as soon as the response is sent.
     - requestLocal(key, create): state that has to stay inside one request.
       Workers forbid awaiting I/O started by a different request, so anything
       holding in-flight promises (single-flight maps) is scoped per request.

   On Node there is no context: background() lets the promise run on its own,
   exactly as the old `.catch(() => {})` did, and requestLocal() returns one
   process-wide value. */

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();
const processLocals = new Map();

function runWithContext(context, fn) {
  return storage.run(context, fn);
}

function currentContext() {
  return storage.getStore() || null;
}

function background(promise) {
  const settled = Promise.resolve(promise).catch(() => {});
  const ctx = currentContext();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(settled);
  return settled;
}

function requestLocal(key, create) {
  const ctx = currentContext();
  const locals = ctx ? (ctx.locals || (ctx.locals = new Map())) : processLocals;
  if (!locals.has(key)) locals.set(key, create());
  return locals.get(key);
}

module.exports = { runWithContext, currentContext, background, requestLocal };
