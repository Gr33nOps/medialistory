/**
 * Keep public.users and Supabase Auth user_metadata in sync for role/ban flags.
 * Middleware (checkBanned / verifyAdmin / verifyModerator) trusts public.users.
 */

const { ensureLocalUser } = require('./localUser');

async function syncUserFlags(db, supabase, userId, flags) {
  const dbPatch = {};
  const metaPatch = {};

  const keys = [
    'is_banned',
    'banned_at',
    'banned_by',
    'ban_reason',
    'is_moderator',
    'is_admin'
  ];

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      dbPatch[key] = flags[key];
      metaPatch[key] = flags[key];
    }
  }

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    throw new Error(error?.message || 'User not found in Auth');
  }

  await ensureLocalUser(db, data.user);

  if (Object.keys(dbPatch).length > 0) {
    await db('users').where({ id: userId }).update(dbPatch);
  }

  const meta = data.user.user_metadata || {};
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, ...metaPatch }
  });

  if (updateError) throw new Error(updateError.message);

  return data.user;
}

module.exports = { syncUserFlags };
