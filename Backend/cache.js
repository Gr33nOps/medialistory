/**
 * Simple in-process TTL cache. Fine for a single Node instance.
 * Swap for Redis later if you scale horizontally.
 */

function createTtlCache() {
  const store = new Map();

  function get(key) {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function set(key, value, ttlMs) {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  function del(key) {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  return { get, set, del, clear };
}

module.exports = { createTtlCache };
