// ============================================
// Data Migration Script: MySQL to Supabase
// ============================================
// This script migrates your existing MySQL data to Supabase
// 
// Prerequisites:
// 1. Run supabase_migration.sql in Supabase SQL Editor first
// 2. mysql2 is an optionalDependency of the root package (or: npm i mysql2)
//    Also needs @supabase/supabase-js and dotenv (already in root package.json)
// 3. Create .env file with your credentials (see below)
//
// Usage: node migrate_data_complete.js
// ============================================

require('dotenv').config();
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONFIGURATION
// ============================================

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'my_game_list',
  timezone: '+00:00' // Use UTC
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use service role key!

const BATCH_SIZE = 100; // Number of records to process in each batch

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatDateForSupabase(date) {
  if (!date) return null;
  if (date instanceof Date) {
    return date.toISOString();
  }
  return new Date(date).toISOString();
}

async function insertInBatches(tableName, records, transformFn = null) {
  if (records.length === 0) {
    console.log(`   No records to insert for ${tableName}`);
    return { success: 0, errors: 0 };
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const transformedBatch = transformFn ? batch.map(transformFn) : batch;

    const { data, error } = await supabase
      .from(tableName)
      .insert(transformedBatch);

    if (error) {
      console.error(`   ⚠️  Batch error (${i}-${i + batch.length}):`, error.message);
      errorCount += batch.length;
    } else {
      successCount += batch.length;
    }

    // Progress indicator
    if ((i + BATCH_SIZE) % 500 === 0) {
      console.log(`   Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
    }
  }

  return { success: successCount, errors: errorCount };
}

// ============================================
// MIGRATION FUNCTIONS
// ============================================

async function migrateGenres(mysqlConn) {
  console.log('📦 Migrating genres...');
  
  const [genres] = await mysqlConn.query(`
    SELECT id, igdb_id, name, slug
    FROM genres
    ORDER BY id
  `);

  console.log(`   Found ${genres.length} genres`);

  const result = await insertInBatches('genres', genres, (genre) => ({
    id: genre.id,
    igdb_id: genre.igdb_id,
    name: genre.name,
    slug: genre.slug
  }));

  console.log(`   ✅ Genres migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateTags(mysqlConn) {
  console.log('📦 Migrating tags...');
  
  const [tags] = await mysqlConn.query(`
    SELECT id, igdb_id, name, slug
    FROM tags
    ORDER BY id
  `);

  console.log(`   Found ${tags.length} tags`);

  const result = await insertInBatches('tags', tags, (tag) => ({
    id: tag.id,
    igdb_id: tag.igdb_id,
    name: tag.name,
    slug: tag.slug
  }));

  console.log(`   ✅ Tags migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migratePlatforms(mysqlConn) {
  console.log('📦 Migrating platforms...');
  
  const [platforms] = await mysqlConn.query(`
    SELECT id, igdb_id, name, slug
    FROM platforms
    ORDER BY id
  `);

  console.log(`   Found ${platforms.length} platforms`);

  const result = await insertInBatches('platforms', platforms, (platform) => ({
    id: platform.id,
    igdb_id: platform.igdb_id,
    name: platform.name,
    slug: platform.slug
  }));

  console.log(`   ✅ Platforms migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateStores(mysqlConn) {
  console.log('📦 Migrating stores...');
  
  const [stores] = await mysqlConn.query(`
    SELECT id, igdb_id, name, slug
    FROM stores
    ORDER BY id
  `);

  console.log(`   Found ${stores.length} stores`);

  const result = await insertInBatches('stores', stores, (store) => ({
    id: store.id,
    igdb_id: store.igdb_id,
    name: store.name,
    slug: store.slug
  }));

  console.log(`   ✅ Stores migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateDevelopers(mysqlConn) {
  console.log('📦 Migrating developers...');
  
  const [developers] = await mysqlConn.query(`
    SELECT id, igdb_id, name, slug
    FROM developers
    ORDER BY id
  `);

  console.log(`   Found ${developers.length} developers`);

  const result = await insertInBatches('developers', developers, (dev) => ({
    id: dev.id,
    igdb_id: dev.igdb_id,
    name: dev.name,
    slug: dev.slug
  }));

  console.log(`   ✅ Developers migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migratePublishers(mysqlConn) {
  console.log('📦 Migrating publishers...');
  
  const [publishers] = await mysqlConn.query(`
    SELECT id, igdb_id, name, slug
    FROM publishers
    ORDER BY id
  `);

  console.log(`   Found ${publishers.length} publishers`);

  const result = await insertInBatches('publishers', publishers, (pub) => ({
    id: pub.id,
    igdb_id: pub.igdb_id,
    name: pub.name,
    slug: pub.slug
  }));

  console.log(`   ✅ Publishers migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGames(mysqlConn) {
  console.log('📦 Migrating games...');
  
  const [games] = await mysqlConn.query(`
    SELECT 
      id, igdb_id, name, slug, description, released,
      background_image, rating, metacritic_score, playtime,
      created_at, updated_at
    FROM games
    ORDER BY id
  `);

  console.log(`   Found ${games.length} games`);

  const result = await insertInBatches('games', games, (game) => ({
    id: game.id,
    igdb_id: game.igdb_id,
    name: game.name,
    slug: game.slug,
    description: game.description,
    released: game.released ? formatDateForSupabase(game.released) : null,
    background_image: game.background_image,
    rating: game.rating ? parseFloat(game.rating) : null,
    metacritic_score: game.metacritic_score,
    playtime: game.playtime || 0,
    created_at: formatDateForSupabase(game.created_at),
    updated_at: formatDateForSupabase(game.updated_at)
  }));

  console.log(`   ✅ Games migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGameGenres(mysqlConn) {
  console.log('📦 Migrating game-genre relationships...');
  
  const [gameGenres] = await mysqlConn.query(`
    SELECT id, game_id, genre_id
    FROM game_genres
    ORDER BY id
  `);

  console.log(`   Found ${gameGenres.length} game-genre relationships`);

  const result = await insertInBatches('game_genres', gameGenres, (gg) => ({
    id: gg.id,
    game_id: gg.game_id,
    genre_id: gg.genre_id
  }));

  console.log(`   ✅ Game-genre relationships migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGameTags(mysqlConn) {
  console.log('📦 Migrating game-tag relationships...');
  
  const [gameTags] = await mysqlConn.query(`
    SELECT id, game_id, tag_id
    FROM game_tags
    ORDER BY id
  `);

  console.log(`   Found ${gameTags.length} game-tag relationships`);

  const result = await insertInBatches('game_tags', gameTags, (gt) => ({
    id: gt.id,
    game_id: gt.game_id,
    tag_id: gt.tag_id
  }));

  console.log(`   ✅ Game-tag relationships migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGamePlatforms(mysqlConn) {
  console.log('📦 Migrating game-platform relationships...');
  
  const [gamePlatforms] = await mysqlConn.query(`
    SELECT id, game_id, platform_id
    FROM game_platforms
    ORDER BY id
  `);

  console.log(`   Found ${gamePlatforms.length} game-platform relationships`);

  const result = await insertInBatches('game_platforms', gamePlatforms, (gp) => ({
    id: gp.id,
    game_id: gp.game_id,
    platform_id: gp.platform_id
  }));

  console.log(`   ✅ Game-platform relationships migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGameDevelopers(mysqlConn) {
  console.log('📦 Migrating game-developer relationships...');
  
  const [gameDevelopers] = await mysqlConn.query(`
    SELECT id, game_id, developer_id
    FROM game_developers
    ORDER BY id
  `);

  console.log(`   Found ${gameDevelopers.length} game-developer relationships`);

  const result = await insertInBatches('game_developers', gameDevelopers, (gd) => ({
    id: gd.id,
    game_id: gd.game_id,
    developer_id: gd.developer_id
  }));

  console.log(`   ✅ Game-developer relationships migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGamePublishers(mysqlConn) {
  console.log('📦 Migrating game-publisher relationships...');
  
  const [gamePublishers] = await mysqlConn.query(`
    SELECT id, game_id, publisher_id
    FROM game_publishers
    ORDER BY id
  `);

  console.log(`   Found ${gamePublishers.length} game-publisher relationships`);

  const result = await insertInBatches('game_publishers', gamePublishers, (gp) => ({
    id: gp.id,
    game_id: gp.game_id,
    publisher_id: gp.publisher_id
  }));

  console.log(`   ✅ Game-publisher relationships migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGameScreenshots(mysqlConn) {
  console.log('📦 Migrating game screenshots...');
  
  const [screenshots] = await mysqlConn.query(`
    SELECT id, game_id, igdb_id, image_url
    FROM game_screenshots
    ORDER BY id
  `);

  console.log(`   Found ${screenshots.length} screenshots`);

  const result = await insertInBatches('game_screenshots', screenshots, (ss) => ({
    id: ss.id,
    game_id: ss.game_id,
    igdb_id: ss.igdb_id,
    image_url: ss.image_url
  }));

  console.log(`   ✅ Game screenshots migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateGameStores(mysqlConn) {
  console.log('📦 Migrating game-store relationships...');
  
  const [gameStores] = await mysqlConn.query(`
    SELECT id, game_id, store_id, store_url
    FROM game_stores
    ORDER BY id
  `);

  console.log(`   Found ${gameStores.length} game-store relationships`);

  const result = await insertInBatches('game_stores', gameStores, (gs) => ({
    id: gs.id,
    game_id: gs.game_id,
    store_id: gs.store_id,
    store_url: gs.store_url
  }));

  console.log(`   ✅ Game-store relationships migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateUsers(mysqlConn) {
  console.log('📦 Migrating users...');
  
  const [mysqlUsers] = await mysqlConn.query(`
    SELECT 
      id,
      supabase_id,
      username,
      email,
      email_verified,
      display_name,
      avatar_url,
      is_moderator,
      is_admin,
      is_banned,
      banned_at,
      banned_by,
      ban_reason,
      last_login,
      created_at,
      updated_at
    FROM users
    ORDER BY id
  `);

  console.log(`   Found ${mysqlUsers.length} users`);

  // First pass: Create all users without banned_by (to avoid FK issues)
  let successCount = 0;
  let errorCount = 0;

  for (const user of mysqlUsers) {
    const { error } = await supabase
      .from('users')
      .insert({
        id: user.supabase_id,
        username: user.username,
        email: user.email,
        email_verified: Boolean(user.email_verified),
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_moderator: Boolean(user.is_moderator),
        is_admin: Boolean(user.is_admin),
        is_banned: Boolean(user.is_banned),
        banned_at: user.banned_at ? formatDateForSupabase(user.banned_at) : null,
        banned_by: null, // Set in second pass
        ban_reason: user.ban_reason,
        last_login: user.last_login ? formatDateForSupabase(user.last_login) : null,
        created_at: formatDateForSupabase(user.created_at),
        updated_at: formatDateForSupabase(user.updated_at)
      });

    if (error) {
      console.error(`   ⚠️  Error migrating user ${user.username}:`, error.message);
      errorCount++;
    } else {
      successCount++;
    }
  }

  // Second pass: Update banned_by references
  console.log('   Updating banned_by references...');
  for (const user of mysqlUsers) {
    if (user.banned_by) {
      const [bannedByUser] = await mysqlConn.query(
        'SELECT supabase_id FROM users WHERE id = ?',
        [user.banned_by]
      );
      
      if (bannedByUser[0]) {
        await supabase
          .from('users')
          .update({ banned_by: bannedByUser[0].supabase_id })
          .eq('id', user.supabase_id);
      }
    }
  }

  console.log(`   ✅ Users migrated (${successCount} success, ${errorCount} errors)\n`);
  return { success: successCount, errors: errorCount };
}

async function migrateUserGameLists(mysqlConn) {
  console.log('📦 Migrating user game lists...');
  
  const [lists] = await mysqlConn.query(`
    SELECT 
      ugl.id,
      u.supabase_id as user_id,
      ugl.game_id,
      ugl.status,
      ugl.score,
      ugl.progress_hours,
      ugl.created_at,
      ugl.updated_at
    FROM user_game_lists ugl
    JOIN users u ON ugl.user_id = u.id
    ORDER BY ugl.id
  `);

  console.log(`   Found ${lists.length} game list entries`);

  const result = await insertInBatches('user_game_lists', lists, (entry) => ({
    id: entry.id,
    user_id: entry.user_id,
    game_id: entry.game_id,
    api_game_id: null, // Using local game_id, not API reference
    status: entry.status,
    score: entry.score ? parseFloat(entry.score) : null,
    progress_hours: entry.progress_hours ? parseFloat(entry.progress_hours) : 0,
    created_at: formatDateForSupabase(entry.created_at),
    updated_at: formatDateForSupabase(entry.updated_at)
  }));

  console.log(`   ✅ User game lists migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateUserReviews(mysqlConn) {
  console.log('📦 Migrating user reviews...');
  
  const [reviews] = await mysqlConn.query(`
    SELECT 
      ur.id,
      u.supabase_id as user_id,
      ur.game_id,
      ur.title,
      ur.content,
      ur.score,
      ur.created_at,
      ur.updated_at
    FROM user_reviews ur
    JOIN users u ON ur.user_id = u.id
    ORDER BY ur.id
  `);

  console.log(`   Found ${reviews.length} reviews`);

  const result = await insertInBatches('user_reviews', reviews, (review) => ({
    id: review.id,
    user_id: review.user_id,
    game_id: review.game_id,
    api_game_id: null, // Using local game_id, not API reference
    title: review.title,
    content: review.content,
    score: review.score ? parseFloat(review.score) : null,
    created_at: formatDateForSupabase(review.created_at),
    updated_at: formatDateForSupabase(review.updated_at)
  }));

  console.log(`   ✅ User reviews migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateUserLists(mysqlConn) {
  console.log('📦 Migrating custom user lists...');
  
  const [lists] = await mysqlConn.query(`
    SELECT 
      ul.id as mysql_list_id,
      u.supabase_id as user_id,
      ul.name,
      ul.description,
      ul.is_public,
      ul.created_at,
      ul.updated_at
    FROM user_lists ul
    JOIN users u ON ul.user_id = u.id
    ORDER BY ul.id
  `);

  console.log(`   Found ${lists.length} custom lists`);

  // Store mapping of MySQL list IDs to Supabase list IDs
  const listIdMap = {};
  let successCount = 0;
  let errorCount = 0;

  for (const list of lists) {
    const { data, error } = await supabase
      .from('user_lists')
      .insert({
        user_id: list.user_id,
        name: list.name,
        description: list.description,
        is_public: Boolean(list.is_public),
        created_at: formatDateForSupabase(list.created_at),
        updated_at: formatDateForSupabase(list.updated_at)
      })
      .select();

    if (error) {
      console.error(`   ⚠️  Error migrating list "${list.name}":`, error.message);
      errorCount++;
    } else if (data && data[0]) {
      listIdMap[list.mysql_list_id] = data[0].id;
      successCount++;
    }
  }

  console.log(`   ✅ Custom lists migrated (${successCount} success, ${errorCount} errors)\n`);
  
  // Return the mapping for use in user_list_games migration
  return { success: successCount, errors: errorCount, listIdMap };
}

async function migrateUserListGames(mysqlConn) {
  console.log('📦 Migrating games in custom lists...');
  
  const [listGames] = await mysqlConn.query(`
    SELECT 
      ulg.id,
      ulg.list_id,
      ulg.game_id,
      ulg.position,
      ulg.created_at
    FROM user_list_games ulg
    ORDER BY ulg.id
  `);

  console.log(`   Found ${listGames.length} games in custom lists`);

  const result = await insertInBatches('user_list_games', listGames, (listGame) => ({
    id: listGame.id,
    list_id: listGame.list_id,
    game_id: listGame.game_id,
    api_game_id: null, // Using local game_id, not API reference
    position: listGame.position,
    created_at: formatDateForSupabase(listGame.created_at)
  }));

  console.log(`   ✅ Custom list games migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateUserFollows(mysqlConn) {
  console.log('📦 Migrating user follows...');
  
  const [follows] = await mysqlConn.query(`
    SELECT 
      uf.id,
      u1.supabase_id as follower_id,
      u2.supabase_id as following_id,
      uf.created_at
    FROM user_follows uf
    JOIN users u1 ON uf.follower_id = u1.id
    JOIN users u2 ON uf.following_id = u2.id
    ORDER BY uf.id
  `);

  console.log(`   Found ${follows.length} follow relationships`);

  const result = await insertInBatches('user_follows', follows, (follow) => ({
    id: follow.id,
    follower_id: follow.follower_id,
    following_id: follow.following_id,
    created_at: formatDateForSupabase(follow.created_at)
  }));

  console.log(`   ✅ User follows migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateBanHistory(mysqlConn) {
  console.log('📦 Migrating ban history...');
  
  const [bans] = await mysqlConn.query(`
    SELECT 
      bh.id,
      u1.supabase_id as user_id,
      u2.supabase_id as banned_by,
      u3.supabase_id as unbanned_by,
      bh.ban_reason,
      bh.banned_at,
      bh.unbanned_at
    FROM ban_history bh
    JOIN users u1 ON bh.user_id = u1.id
    JOIN users u2 ON bh.banned_by = u2.id
    LEFT JOIN users u3 ON bh.unbanned_by = u3.id
    ORDER BY bh.id
  `);

  console.log(`   Found ${bans.length} ban history records`);

  const result = await insertInBatches('ban_history', bans, (ban) => ({
    id: ban.id,
    user_id: ban.user_id,
    banned_by: ban.banned_by,
    unbanned_by: ban.unbanned_by,
    ban_reason: ban.ban_reason,
    banned_at: formatDateForSupabase(ban.banned_at),
    unbanned_at: ban.unbanned_at ? formatDateForSupabase(ban.unbanned_at) : null
  }));

  console.log(`   ✅ Ban history migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateModeratorActivity(mysqlConn) {
  console.log('📦 Migrating moderator activity...');
  
  const [activities] = await mysqlConn.query(`
    SELECT 
      ma.id,
      u.supabase_id as moderator_id,
      ma.action_type,
      ma.target_type,
      ma.target_id,
      ma.details,
      ma.created_at
    FROM moderator_activity ma
    JOIN users u ON ma.moderator_id = u.id
    ORDER BY ma.id
  `);

  console.log(`   Found ${activities.length} moderator activity records`);

  const result = await insertInBatches('moderator_activity', activities, (activity) => ({
    id: activity.id,
    moderator_id: activity.moderator_id,
    action_type: activity.action_type,
    target_type: activity.target_type,
    target_id: activity.target_id,
    details: activity.details,
    created_at: formatDateForSupabase(activity.created_at)
  }));

  console.log(`   ✅ Moderator activity migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

async function migrateSessions(mysqlConn) {
  console.log('📦 Migrating sessions...');
  
  const [sessions] = await mysqlConn.query(`
    SELECT 
      s.id,
      u.supabase_id as user_id,
      s.session_token,
      s.refresh_token,
      s.expires_at,
      s.created_at,
      s.last_activity,
      s.ip_address,
      s.user_agent
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.id
  `);

  console.log(`   Found ${sessions.length} sessions`);

  const result = await insertInBatches('sessions', sessions, (session) => ({
    id: session.id,
    user_id: session.user_id,
    session_token: session.session_token,
    refresh_token: session.refresh_token,
    expires_at: formatDateForSupabase(session.expires_at),
    created_at: formatDateForSupabase(session.created_at),
    last_activity: formatDateForSupabase(session.last_activity),
    ip_address: session.ip_address,
    user_agent: session.user_agent
  }));

  console.log(`   ✅ Sessions migrated (${result.success} success, ${result.errors} errors)\n`);
  return result;
}

// ============================================
// MAIN MIGRATION
// ============================================

async function migrate() {
  console.log('🚀 Starting complete migration from MySQL to Supabase...\n');
  console.log(`⚙️  Batch size: ${BATCH_SIZE} records per batch\n`);

  let mysqlConn;
  const startTime = Date.now();
  
  try {
    // Connect to MySQL
    console.log('🔌 Connecting to MySQL...');
    mysqlConn = await mysql.createConnection(MYSQL_CONFIG);
    console.log('   ✅ Connected to MySQL\n');

    // Run migrations in dependency order
    console.log('=' .repeat(50));
    console.log('PHASE 1: Core Game Data Tables');
    console.log('=' .repeat(50) + '\n');
    
    await migrateGenres(mysqlConn);
    await migrateTags(mysqlConn);
    await migratePlatforms(mysqlConn);
    await migrateStores(mysqlConn);
    await migrateDevelopers(mysqlConn);
    await migratePublishers(mysqlConn);
    await migrateGames(mysqlConn);

    console.log('=' .repeat(50));
    console.log('PHASE 2: Game Relationship Tables');
    console.log('=' .repeat(50) + '\n');

    await migrateGameGenres(mysqlConn);
    await migrateGameTags(mysqlConn);
    await migrateGamePlatforms(mysqlConn);
    await migrateGameDevelopers(mysqlConn);
    await migrateGamePublishers(mysqlConn);
    await migrateGameScreenshots(mysqlConn);
    await migrateGameStores(mysqlConn);

    console.log('=' .repeat(50));
    console.log('PHASE 3: User Tables');
    console.log('=' .repeat(50) + '\n');

    await migrateUsers(mysqlConn);
    await migrateUserGameLists(mysqlConn);
    await migrateUserReviews(mysqlConn);
    await migrateUserLists(mysqlConn);
    await migrateUserListGames(mysqlConn);
    await migrateUserFollows(mysqlConn);
    await migrateBanHistory(mysqlConn);
    await migrateModeratorActivity(mysqlConn);
    await migrateSessions(mysqlConn);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('=' .repeat(50));
    console.log('🎉 Migration completed successfully!');
    console.log('=' .repeat(50));
    console.log(`⏱️  Total time: ${duration} seconds\n`);
    
    console.log('📋 Next steps:');
    console.log('   1. Verify data in Supabase dashboard');
    console.log('   2. Check row counts match your MySQL database');
    console.log('   3. Test queries and relationships');
    console.log('   4. Update your application to use Supabase');
    console.log('   5. Keep MySQL backup until everything is verified\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (mysqlConn) {
      await mysqlConn.end();
      console.log('🔌 MySQL connection closed');
    }
  }
}

// Run migration
migrate();