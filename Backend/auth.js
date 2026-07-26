const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { clientError } = require('./errors');
const {
  ensureLocalUser,
  findUserByUsername,
  isUsernameTaken,
  allocateUsername
} = require('./localUser');
const {
  attachAuthCookie,
  clearAuthCookieHeader,
  getTokenFromRequest
} = require('./sessionCookies');

module.exports = (db, jwt, JWT_SECRET, verifyToken, checkBanned) => {
  const router = express.Router();

  const supabase = getSupabaseAdmin();

  const publicSupabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  function sendAuthSession(res, token, user, extra = {}) {
    attachAuthCookie(res, token, !!extra.rememberMe);
    res.json({ token, user, ...extra });
  }

  async function formatUser(sbUser, dbUser = null) {
    const meta = sbUser.user_metadata || {};

    if (!dbUser) {
      try {
        dbUser = await db('users').where({ id: sbUser.id }).first();
      } catch (_) {
        dbUser = null;
      }
    }

    return {
      id:           sbUser.id,
      email:        sbUser.email,
      username:     dbUser?.username     || meta.username     || sbUser.email.split('@')[0],
      display_name: dbUser?.display_name || meta.display_name || meta.username || sbUser.email.split('@')[0],
      avatar_url:   dbUser?.avatar_url   || meta.avatar_url   || null,
      is_admin:     dbUser?.is_admin     ?? meta.is_admin     ?? false,
      is_moderator: dbUser?.is_moderator ?? meta.is_moderator ?? false,
      is_banned:    dbUser?.is_banned    ?? meta.is_banned    ?? false,
      ban_reason:   dbUser?.ban_reason   || meta.ban_reason   || null,
    };
  }

  function isUniqueViolation(err) {
    return err && (err.code === '23505' || /unique|duplicate/i.test(err.message || ''));
  }

  async function issueJwt(userId, rememberMe = false) {
    let tv = 0;
    try {
      const row = await db('users').where({ id: userId }).first('token_version');
      tv = Number(row?.token_version || 0);
    } catch (_) {}

    // Default stays signed in for a week; "Remember me" extends to 30 days.
    const expiresIn = rememberMe ? '30d' : '7d';
    return jwt.sign({ userId, tv }, JWT_SECRET, { expiresIn });
  }

  /** Public values safe for the browser (anon key is designed for client use). */
  router.get('/public-config', (req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      providers: ['google', 'discord']
    });
  });

  /**
   * Finish Google/Discord (or other) OAuth after the browser has a Supabase access token.
   * Body: { access_token, rememberMe? }
   */
  router.post('/oauth/complete', async (req, res) => {
    try {
      const accessToken = String(req.body?.access_token || '').trim();
      const rememberMe = !!req.body?.rememberMe;
      if (!accessToken) {
        return res.status(400).json({ error: 'access_token is required' });
      }

      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error || !data?.user) {
        return res.status(401).json({ error: 'Invalid or expired OAuth session' });
      }

      const sbUser = data.user;
      const meta = sbUser.user_metadata || {};
      const existing = await db('users').where({ id: sbUser.id }).first();
      const isNewUser = !existing;

      const preferred =
        meta.user_name ||
        meta.preferred_username ||
        meta.full_name ||
        meta.name ||
        (sbUser.email || '').split('@')[0] ||
        'player';

      const username = isNewUser
        ? await allocateUsername(db, preferred, sbUser.id)
        : (existing.username || await allocateUsername(db, preferred, sbUser.id));
      const display_name = (
        meta.full_name ||
        meta.name ||
        meta.custom_claims?.global_name ||
        preferred
      ).toString().slice(0, 100);
      const avatar_url = meta.avatar_url || meta.picture || null;

      let dbUser;
      try {
        dbUser = await ensureLocalUser(db, sbUser, {
          username,
          display_name,
          avatar_url
        });
      } catch (err) {
        console.warn('ensureLocalUser on oauth:', err.message);
        dbUser = await db('users').where({ id: sbUser.id }).first();
      }

      if (!dbUser) {
        return res.status(500).json({ error: 'Could not create local user profile' });
      }

      if (dbUser.is_banned) {
        return res.status(403).json({
          error: 'Your account has been banned.',
          reason: dbUser.ban_reason || null
        });
      }

      // Username is auto-allocated; send users straight into the app (one OAuth click).
      if (isNewUser && meta.username_chosen !== true) {
        try {
          await supabase.auth.admin.updateUserById(sbUser.id, {
            user_metadata: { ...meta, username: dbUser.username, username_chosen: true }
          });
        } catch (metaErr) {
          console.warn('oauth username_chosen meta:', metaErr.message);
        }
      }

      const token = await issueJwt(sbUser.id, rememberMe);
      sendAuthSession(res, token, await formatUser(sbUser, dbUser), {
        rememberMe,
        needsUsername: false,
        suggestedUsername: dbUser.username
      });
    } catch (error) {
      return clientError(res, 500, 'OAuth login failed', error);
    }
  });

  /** Claim / change username after OAuth (or any first login). */
  router.put('/username', verifyToken, checkBanned, async (req, res) => {
    try {
      const clean = String(req.body?.username || '').trim();
      if (!/^[a-zA-Z0-9_]{3,50}$/.test(clean)) {
        return res.status(400).json({
          error: 'Username must be 3-50 characters (letters, numbers, underscores).'
        });
      }
      if (await isUsernameTaken(db, clean, req.userId)) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      await db('users').where({ id: req.userId }).update({
        username: clean,
        updated_at: db.fn.now()
      });

      const { data: current } = await supabase.auth.admin.getUserById(req.userId);
      const meta = current?.user?.user_metadata || {};
      await supabase.auth.admin.updateUserById(req.userId, {
        user_metadata: { ...meta, username: clean, username_chosen: true }
      });

      const dbUser = await db('users').where({ id: req.userId }).first();
      res.json({
        message: 'Username saved',
        user: await formatUser(current.user, dbUser)
      });
    } catch (error) {
      return clientError(res, 500, 'Could not save username', error);
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const { username, email, display_name, password } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const cleanUsername = String(username).trim();
      if (cleanUsername.length < 3 || cleanUsername.length > 50) {
        return res.status(400).json({ error: 'Username must be 3-50 characters' });
      }

      if (await isUsernameTaken(db, cleanUsername)) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      let frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      if (frontendUrl && !/^https?:\/\//i.test(frontendUrl)) frontendUrl = `https://${frontendUrl}`;

      const { data, error: sbError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: cleanUsername,
            display_name: display_name || cleanUsername,
            is_admin:     false,
            is_moderator: false,
            is_banned:    false,
          },
          emailRedirectTo: `${frontendUrl}/auth.html`
        }
      });

      if (sbError) {
        if (sbError.message?.toLowerCase().includes('already registered')) {
          await supabase.auth.resend({ type: 'signup', email });
          return res.json({
            success: true,
            message: 'Account already registered. A new verification email has been sent.',
            email
          });
        }
        return clientError(res, 400, 'Registration failed', sbError);
      }

      if (data.user && data.user.identities && data.user.identities.length === 0) {
        await supabase.auth.resend({ type: 'signup', email });
        return res.json({
          success: true,
          message: 'Account already registered. A new verification email has been sent.',
          email
        });
      }

      // Reserve username in public.users immediately (DB unique index is source of truth).
      if (data.user) {
        try {
          await ensureLocalUser(db, data.user, {
            username: cleanUsername,
            display_name: display_name || cleanUsername
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            await supabase.auth.admin.deleteUser(data.user.id).catch(() => {});
            return res.status(400).json({ error: 'Username already taken' });
          }
          console.warn('ensureLocalUser on register:', err.message);
        }
      }

      res.json({
        success: true,
        message: 'Account created! Please check your email to verify.',
        email
      });
    } catch (error) {
      console.error('Registration error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.post('/verify-email', async (req, res) => {
    try {
      const { code, token_hash } = req.body;
      const verificationToken = token_hash || code;

      if (!verificationToken) {
        return res.status(400).json({ error: 'Verification token is required' });
      }

      let verifiedUser = null;

      for (const type of ['email', 'signup']) {
        const { data, error } = await publicSupabase.auth.verifyOtp({
          token_hash: verificationToken,
          type
        });
        if (!error && data?.user) {
          verifiedUser = data.user;
          break;
        }
      }

      if (!verifiedUser) {
        return res.status(400).json({
          error: 'Invalid or expired verification link. Please request a new verification email.'
        });
      }

      try {
        await ensureLocalUser(db, verifiedUser);
      } catch (err) {
        console.warn('ensureLocalUser on verify:', err.message);
      }

      res.json({
        success: true,
        message: 'Email verified successfully! You can now log in.',
        user: {
          id:             verifiedUser.id,
          email:          verifiedUser.email,
          email_verified: true
        }
      });
    } catch (error) {
      console.error('Email verification error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.post('/resend-verification', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });

      const { error } = await supabase.auth.resend({ type: 'signup', email });

      if (error) {
        return clientError(res, 400, 'Could not resend verification email', error);
      }

      res.json({ success: true, message: 'Verification email sent! Check your inbox and spam folder.' });
    } catch (error) {
      console.error('Resend verification error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.get('/check-username/:username', async (req, res) => {
    try {
      const { username } = req.params;
      const exists = await isUsernameTaken(db, username);
      res.json({ exists });
    } catch (error) {
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { emailOrUsername, password, rememberMe } = req.body;

      if (!emailOrUsername || !password) {
        return res.status(400).json({ error: 'Email/username and password are required' });
      }

      let email = emailOrUsername;

      if (!emailOrUsername.includes('@')) {
        const match = await findUserByUsername(db, emailOrUsername);
        if (!match?.email) return res.status(401).json({ error: 'Invalid credentials' });
        email = match.email;
      }

      const { data: authData, error: authError } = await publicSupabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        if (
          authError.message?.includes('Email not confirmed') ||
          authError.code === 'email_not_confirmed'
        ) {
          return res.status(403).json({
            error: 'Please verify your email before logging in.',
            emailNotVerified: true,
            email
          });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const sbUser = authData.user;

      if (!sbUser.email_confirmed_at) {
        return res.status(403).json({
          error: 'Please verify your email before logging in.',
          emailNotVerified: true,
          email: sbUser.email
        });
      }

      let dbUser;
      try {
        dbUser = await ensureLocalUser(db, sbUser);
      } catch (err) {
        console.warn('ensureLocalUser on login:', err.message);
        dbUser = await db('users').where({ id: sbUser.id }).first();
      }

      if (dbUser?.is_banned) {
        return res.status(403).json({
          error: 'Your account has been banned.',
          reason: dbUser.ban_reason || null
        });
      }

      const token = await issueJwt(sbUser.id, rememberMe);
      sendAuthSession(res, token, await formatUser(sbUser, dbUser), { rememberMe });
    } catch (error) {
      return clientError(res, 500, 'Login failed', error);
    }
  });

  /**
   * Restore / slide a session from Bearer or httpOnly cookie.
   * Used so returning visitors stay signed in without logging in again.
   */
  router.get('/session', async (req, res) => {
    try {
      const existing = getTokenFromRequest(req);
      if (!existing) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      let payload;
      try {
        payload = jwt.verify(existing, JWT_SECRET);
      } catch (_) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const userId = payload.userId || payload.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      try {
        const row = await db('users').where({ id: userId }).first('token_version', 'is_banned', 'ban_reason');
        if (row?.is_banned) {
          return res.status(403).json({
            error: 'Your account has been banned.',
            reason: row.ban_reason || null
          });
        }
        const tv = Number(row?.token_version || 0);
        if (payload.tv != null && Number(payload.tv) !== tv) {
          return res.status(401).json({ error: 'Session expired. Please sign in again.' });
        }
      } catch (_) {
        /* token_version column may be missing */
      }

      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user) return res.status(401).json({ error: 'Unauthorized' });

      let dbUser;
      try {
        dbUser = await ensureLocalUser(db, data.user);
      } catch (_) {
        dbUser = await db('users').where({ id: userId }).first();
      }
      if (!dbUser) return res.status(401).json({ error: 'Unauthorized' });

      const token = await issueJwt(userId, true);
      sendAuthSession(res, token, await formatUser(data.user, dbUser), { rememberMe: true });
    } catch (error) {
      return clientError(res, 500, 'Session restore failed', error);
    }
  });

  router.get('/verify', verifyToken, async (req, res) => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(req.userId);
      if (error || !data?.user) return res.status(404).json({ error: 'User not found' });

      let dbUser;
      try {
        dbUser = await ensureLocalUser(db, data.user);
      } catch (_) {
        dbUser = await db('users').where({ id: req.userId }).first();
      }

      if (dbUser?.is_banned) {
        return res.status(403).json({ error: 'Your account has been banned.' });
      }

      res.json({ valid: true, user: await formatUser(data.user, dbUser) });
    } catch (error) {
      console.error('Token verification error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.get('/me', verifyToken, async (req, res) => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(req.userId);
      if (error || !data?.user) return res.status(404).json({ error: 'User not found' });

      let dbUser;
      try {
        dbUser = await ensureLocalUser(db, data.user);
      } catch (_) {
        dbUser = await db('users').where({ id: req.userId }).first();
      }

      res.json({ user: await formatUser(data.user, dbUser) });
    } catch (error) {
      console.error('Get me error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.post('/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });

      let frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      if (frontendUrl && !/^https?:\/\//i.test(frontendUrl)) frontendUrl = `https://${frontendUrl}`;

      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${frontendUrl}/auth.html?type=recovery`
      });

      res.json({ success: true, message: 'If a matching account exists, a reset link has been sent.' });
    } catch (error) {
      console.error('Forgot password error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  router.post('/reset-password', async (req, res) => {
    try {
      const { code, password } = req.body;

      if (!code || !password) {
        return res.status(400).json({ error: 'Code and password are required' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const { data: sessionData, error: exchangeError } = await publicSupabase.auth.exchangeCodeForSession(code);

      if (exchangeError || !sessionData?.user) {
        return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(
        sessionData.user.id,
        { password }
      );

      if (updateError) {
        return clientError(res, 400, 'Failed to reset password', updateError);
      }

      try {
        await db('users')
          .where({ id: sessionData.user.id })
          .update({ token_version: db.raw('COALESCE(token_version, 0) + 1') });
      } catch (err) {
        console.warn('token_version bump skipped:', err.message);
      }

      res.json({ success: true, message: 'Password reset successfully!' });
    } catch (error) {
      return clientError(res, 500, 'Password reset failed', error);
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      await publicSupabase.auth.signOut().catch(() => {});
      clearAuthCookieHeader(res);
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      return clientError(res, 500, 'Server error', error);
    }
  });

  return router;
};