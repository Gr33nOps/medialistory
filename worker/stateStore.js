/* StateStore: the small amount of state that has to be shared between Worker
   isolates, where module memory is not shared. One Durable Object instance
   per key, so each is strongly consistent and single-threaded:

     rl:auth:<ip>   fixed-window counter for the auth rate limit
     oauth:<code>   one-time OAuth hand-off entry (read once, then deleted)
     igdb:token     the Twitch app token for IGDB

   Every instance schedules an alarm for when its data expires and wipes
   itself then, so nothing accumulates. */

import { DurableObject } from 'cloudflare:workers';

export class StateStore extends DurableObject {
  async expireAt(ms) {
    const current = await this.ctx.storage.getAlarm();
    if (current == null || current < ms) await this.ctx.storage.setAlarm(ms);
  }

  async alarm() {
    const expiresAt = await this.ctx.storage.get('expiresAt');
    if (expiresAt != null && Number(expiresAt) > Date.now()) {
      await this.ctx.storage.setAlarm(Number(expiresAt));
      return;
    }
    await this.ctx.storage.deleteAll();
  }

  /* Count one request against a fixed window that opens on the first hit,
     the same semantics as express-rate-limit's memory store. */
  async hit(limit, windowMs) {
    const now = Date.now();
    let window = await this.ctx.storage.get('window');
    if (!window || window.resetAt <= now) window = { count: 0, resetAt: now + windowMs };
    window.count += 1;
    await this.ctx.storage.put({ window, expiresAt: window.resetAt });
    await this.expireAt(window.resetAt);
    return {
      allowed: window.count <= limit,
      limit,
      remaining: Math.max(0, limit - window.count),
      resetAt: window.resetAt
    };
  }

  async put(value, ttlMs) {
    const expiresAt = Date.now() + ttlMs;
    await this.ctx.storage.put({ value, expiresAt });
    await this.expireAt(expiresAt);
  }

  async get() {
    const [value, expiresAt] = await Promise.all([
      this.ctx.storage.get('value'),
      this.ctx.storage.get('expiresAt')
    ]);
    if (value === undefined || Number(expiresAt) <= Date.now()) return null;
    return value;
  }

  /* Read and delete in one step. Durable Objects run one call at a time, so a
     second exchange of the same code always finds nothing. */
  async take() {
    const value = await this.get();
    await this.ctx.storage.deleteAll();
    return value;
  }
}

function stub(env, name) {
  return env.STATE_STORE.get(env.STATE_STORE.idFromName(name));
}

/** OAuth hand-off codes (see Backend/auth.js), single use, 2 minute TTL. */
export function createOauthCodeStore(env, ttlMs) {
  return {
    async create(entry) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const code = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      await stub(env, `oauth:${code}`).put(entry, ttlMs);
      return code;
    },
    async consume(code) {
      const key = String(code || '');
      if (!/^[0-9a-f]{64}$/.test(key)) return null;
      return stub(env, `oauth:${key}`).take();
    }
  };
}

/** The IGDB/Twitch app token, shared by every isolate (see Backend/igdb.js). */
export function createIgdbTokenStore(env) {
  return {
    get: () => stub(env, 'igdb:token').get(),
    set: ({ token, expiresAt }) => stub(env, 'igdb:token').put({ token, expiresAt }, Math.max(0, expiresAt - Date.now()))
  };
}

/** Fixed-window limiter keyed by client IP. */
export function hitAuthLimit(env, ip, limit, windowMs) {
  return stub(env, `rl:auth:${ip || 'unknown'}`).hit(limit, windowMs);
}
