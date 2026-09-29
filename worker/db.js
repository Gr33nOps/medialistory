/* Database access for the Worker.

   The route modules receive one `db` when they are built and call it as a
   Knex instance: db('users'), db.raw(), db.fn.now(), db.transaction().
   Workers cannot share a connection between requests, so that `db` is a
   proxy: each request gets its own Knex instance, opened on first use and
   destroyed after the response (worker/index.js). Hyperdrive does the real
   connection pooling in front of Neon, so opening one per request is cheap. */

import knexFactory from 'knex';
import PgDialect from 'knex/lib/dialects/postgres/index.js';
import pg from 'pg';
import { currentContext } from '../Backend/runtime.js';

// Knex loads its driver with a lazy require('pg') that the bundler resolves to
// the ES module namespace rather than the package, so hand it the driver.
class WorkerPg extends PgDialect {
  _driver() {
    return pg;
  }
}

export function createKnex(connectionString) {
  return knexFactory({
    client: WorkerPg,
    connection: { connectionString },
    // A few connections, not one: a handler can run queries in parallel, and
    // a transaction holds its connection while other queries wait.
    pool: { min: 0, max: 4 },
    acquireConnectionTimeout: 15000
  });
}

function requestKnex() {
  const ctx = currentContext();
  if (!ctx || !ctx.env) throw new Error('Database used outside a request');
  if (!ctx.knex) {
    if (!ctx.env.HYPERDRIVE) throw new Error('HYPERDRIVE binding is not configured');
    ctx.knex = createKnex(ctx.env.HYPERDRIVE.connectionString);
  }
  return ctx.knex;
}

/** A stand-in for a Knex instance that resolves to the current request's one. */
export function createDbProxy() {
  return new Proxy(function db() {}, {
    apply(_target, _thisArg, args) {
      return requestKnex()(...args);
    },
    get(_target, prop) {
      const knex = requestKnex();
      const value = knex[prop];
      return typeof value === 'function' ? value.bind(knex) : value;
    }
  });
}
