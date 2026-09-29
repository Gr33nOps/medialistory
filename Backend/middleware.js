/* Authentication and role middleware, shared by the Node server and the Worker.
   Moved out of server.js unchanged apart from verifying the JWT through
   appJwt (async) instead of jsonwebtoken (sync). */

const appJwt = require('./appJwt');
const { clientError } = require('./errors');
const { getTokenFromRequest } = require('./sessionCookies');

function createAuthMiddleware(db, jwtSecret) {
  const verifyToken = async (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    let decoded;
    try {
      decoded = await appJwt.verify(token, jwtSecret);
    } catch (_) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.userId = decoded.userId;
    req.tokenVersion = Number(decoded.tv || 0);

    try {
      const row = await db('users').where({ id: req.userId }).first('token_version');
      if (row && Number(row.token_version || 0) !== req.tokenVersion) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    } catch (_) {
      // token_version column may not exist yet - allow token until migration is applied
    }

    return next();
  };

  // Guest-friendly auth: attach req.userId when a valid token is present, otherwise
  // continue as an anonymous visitor. Banned users are still blocked. Used for
  // read-only catalog browse so guests can explore before creating an account.
  const optionalAuth = async (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) return next();
    let decoded;
    try {
      decoded = await appJwt.verify(token, jwtSecret);
    } catch (_) {
      return next();
    }
    req.userId = decoded.userId;
    try {
      const row = await db('users').where({ id: req.userId }).first('is_banned');
      if (row && row.is_banned) return res.status(403).json({ error: 'Your account has been banned' });
    } catch (_) {}
    return next();
  };

  const passThrough = (req, res, next) => next();

  const checkBanned = async (req, res, next) => {
    try {
      const dbUser = await db('users').where({ id: req.userId }).first();
      if (!dbUser) return res.status(401).json({ error: 'User not found' });

      if (dbUser.is_banned) {
        return res.status(403).json({
          error: 'Your account has been banned',
          reason: dbUser.ban_reason || null
        });
      }
      return next();
    } catch (error) {
      return clientError(res, 500, 'Server error', error);
    }
  };

  const verifyModerator = async (req, res, next) => {
    try {
      const dbUser = await db('users').where({ id: req.userId }).first();
      if (!dbUser) return res.status(401).json({ error: 'User not found' });

      if (dbUser.is_banned) {
        return res.status(403).json({ error: 'Your account has been banned' });
      }
      if (!dbUser.is_moderator && !dbUser.is_admin) {
        return res.status(403).json({ error: 'Moderator access required' });
      }

      req.userRole = {
        isModerator: dbUser.is_moderator || dbUser.is_admin,
        isAdmin:     dbUser.is_admin || false
      };

      return next();
    } catch (error) {
      return clientError(res, 500, 'Server error', error);
    }
  };

  const verifyAdmin = async (req, res, next) => {
    try {
      const dbUser = await db('users').where({ id: req.userId }).first();
      if (!dbUser) return res.status(401).json({ error: 'User not found' });

      if (dbUser.is_banned) {
        return res.status(403).json({ error: 'Your account has been banned' });
      }
      if (!dbUser.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      req.userRole = { isModerator: true, isAdmin: true };
      return next();
    } catch (error) {
      return clientError(res, 500, 'Server error', error);
    }
  };

  async function logModeratorActivity(moderatorId, actionType, targetType, targetId, details = null) {
    try {
      await db('moderator_activity').insert({
        moderator_id: moderatorId,
        action_type:  actionType,
        target_type:  targetType,
        target_id:    targetId,
        details:      details
      });
    } catch (error) {
      console.error('Activity logging error:', error);
    }
  }

  return { verifyToken, optionalAuth, passThrough, checkBanned, verifyModerator, verifyAdmin, logModeratorActivity };
}

module.exports = { createAuthMiddleware };
