/* The API route table, shared by the Node server and the Worker so both mount
   the same routers, in the same order, behind the same limiters.

   Order matters: several routers share a prefix (/api, /api/user) and a
   request falls through them in turn, exactly as it did under Express.

   Every mount is repeated under /api/v1 as a compatibility alias. The alias
   reuses the same router instances, so both paths share one set of caches. */

const appJwt = require('./appJwt');
const { createAuthMiddleware } = require('./middleware');

function buildApiRoutes({ db, jwtSecret, limiters = {}, oauthCodes, igdbTokenStore, warmCatalog = true }) {
  const auth = createAuthMiddleware(db, jwtSecret);
  const { verifyToken, optionalAuth, passThrough, checkBanned, verifyModerator, verifyAdmin, logModeratorActivity } = auth;
  const authLimiter = limiters.auth || passThrough;
  const catalogLimiter = limiters.catalog || passThrough;

  const seasonSources = require('./seasonSources');
  const seasonDeps = { fetchSeasons: seasonSources.fetchSeasons };

  const authRouter = require('./auth')(db, appJwt, jwtSecret, verifyToken, checkBanned, { oauthCodes });
  const homeRouter = require('./home')(db);
  const profileRouter = require('./profile')(db, verifyToken, checkBanned);
  const libraryRouter = require('./library')(db, verifyToken, checkBanned, seasonDeps);
  const seasonRouter = require('./seasons')(db, verifyToken, checkBanned, seasonDeps);
  const friendsRouter = require('./friends')(db, verifyToken, checkBanned);
  const userProfileRouter = require('./userProfile')(db, verifyToken, checkBanned);
  const adminRouter = require('./admin')(db, verifyToken, verifyModerator, verifyAdmin, logModeratorActivity);
  const moderatorRouter = require('./moderator')(db, verifyToken, verifyModerator, logModeratorActivity);
  const igdbRouter = require('./igdb')(optionalAuth, passThrough, db, { tokenStore: igdbTokenStore, warmCatalog });
  // Profiles for the names beside a title: TMDB people, Kitsu characters and
  // IGDB companies, normalised to one shape so one page renders all three.
  const peopleRouter = require('./people')(optionalAuth, passThrough, { igdbFetch: igdbRouter.igdbFetch });
  const tmdbRouter = require('./tmdb')(optionalAuth, passThrough, db);
  const kitsuRouter = require('./kitsu')(optionalAuth, passThrough, db);

  /* Secondary sources: game prices (CheapShark), anime score and themes
     (MyAnimeList via Jikan, AnimeThemes), upcoming episodes (TVmaze). Strictly
     additive - if this fails to load, every core route still works. */
  let enrichRouter = null;
  try {
    const externalIds = require('./externalIds')({
      db,
      igdbFetch: igdbRouter.igdbFetch,
      tmdbFetch: tmdbRouter.tmdbFetch
    });
    enrichRouter = require('./enrich')(optionalAuth, passThrough, { externalIds });
  } catch (error) {
    // Deliberately not fatal: detail pages simply render without the extras.
    console.error('Enrichment routes unavailable:', error.message);
  }

  const table = [
    ['/auth', authLimiter, authRouter],
    ['', homeRouter],
    ['/user', profileRouter],
    ['/user', libraryRouter],
    ['/user', seasonRouter],
    ['', friendsRouter],
    ['/users', userProfileRouter],
    ['/admin', adminRouter],
    ['/moderator', moderatorRouter],
    ['/igdb', catalogLimiter, igdbRouter],
    ['/people', peopleRouter],
    ['/tmdb', catalogLimiter, tmdbRouter],
    ['/kitsu', catalogLimiter, kitsuRouter]
  ];
  if (enrichRouter) table.push(['/enrich', catalogLimiter, enrichRouter]);

  const mounts = [];
  for (const base of ['/api', '/api/v1']) {
    for (const [prefix, ...handlers] of table) mounts.push([base + prefix, ...handlers]);
  }
  return { mounts, auth, igdbRouter };
}

module.exports = { buildApiRoutes };
