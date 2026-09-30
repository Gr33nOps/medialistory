/* syncUserFlags updates only the role and ban columns it is given, and never
   touches anything else. The database is a small stand-in for the Knex calls
   the function makes. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncUserFlags } = require('../../Backend/userRoles');

function fakeDb(existing) {
  const calls = { updates: [] };
  const db = (table) => {
    assert.equal(table, 'users');
    return {
      where(cond) { calls.where = cond; return this; },
      first: async () => existing,
      update: async (patch) => { calls.updates.push(patch); }
    };
  };
  return { db, calls };
}

test('applies only the known role and ban flags', async () => {
  const { db, calls } = fakeDb({ id: 'u1', is_admin: false });
  const user = await syncUserFlags(db, 'u1', {
    is_banned: true,
    ban_reason: 'spam',
    email: 'attacker@example.test',
    is_admin: true
  });
  assert.equal(user.id, 'u1');
  assert.deepEqual(calls.where, { id: 'u1' });
  assert.deepEqual(calls.updates, [{ is_banned: true, ban_reason: 'spam', is_admin: true }]);
});

test('makes no update when no known flag is given', async () => {
  const { db, calls } = fakeDb({ id: 'u1' });
  await syncUserFlags(db, 'u1', { display_name: 'ignored' });
  assert.deepEqual(calls.updates, []);
});

test('rejects an unknown user', async () => {
  const { db } = fakeDb(undefined);
  await assert.rejects(syncUserFlags(db, 'missing', { is_banned: true }), /User not found/);
});
