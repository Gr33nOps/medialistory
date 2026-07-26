const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { clientError } = require('./errors');

module.exports = (db, verifyToken, checkBanned) => {
  const router = express.Router();

  const supabaseAdmin = getSupabaseAdmin();

  router.get('/profile', verifyToken, checkBanned, async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(req.userId);
      if (error || !data?.user) return res.status(404).json({ error: 'User not found' });

      const u    = data.user;
      const meta = u.user_metadata || {};

      res.json({
        user: {
          id:           u.id,
          email:        u.email,
          username:     meta.username     || u.email?.split('@')[0] || '',
          display_name: meta.display_name || meta.username || '',
          avatar_url:   meta.avatar_url   || null,
          created_at:   u.created_at,
          updated_at:   u.updated_at
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/profile', verifyToken, checkBanned, async (req, res) => {
    try {
      const { display_name, email, avatar_url } = req.body;

      if (!display_name || !email) {
        return res.status(400).json({ error: 'Display name and email are required' });
      }

      const { data: currentData, error: fetchError } = await supabaseAdmin.auth.admin.getUserById(req.userId);
      if (fetchError || !currentData?.user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const currentMeta = currentData.user.user_metadata || {};

      const updatePayload = {
        user_metadata: {
          ...currentMeta,
          display_name: display_name.trim(),
          avatar_url:   avatar_url?.trim() || null
        }
      };

      if (email.trim() !== currentData.user.email) {
        updatePayload.email = email.trim();
      }

      const { data: updatedData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        req.userId,
        updatePayload
      );

      if (updateError) {
        console.error('Supabase profile update error:', updateError);
        if (updateError.message?.toLowerCase().includes('email')) {
          return res.status(400).json({ error: 'Email already in use by another account' });
        }
        return clientError(res, 400, 'Failed to update profile', updateError);
      }

      const u    = updatedData.user;
      const meta = u.user_metadata || {};

      res.json({
        message: 'Profile updated successfully',
        user: {
          id:           u.id,
          email:        u.email,
          username:     meta.username     || u.email?.split('@')[0] || '',
          display_name: meta.display_name || '',
          avatar_url:   meta.avatar_url   || null,
          created_at:   u.created_at,
          updated_at:   u.updated_at
        }
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/password', verifyToken, checkBanned, async (req, res) => {
    try {
      const { current_password, new_password } = req.body;

      if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      if (new_password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const { data: userData, error: fetchError } = await supabaseAdmin.auth.admin.getUserById(req.userId);
      if (fetchError || !userData?.user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const supabasePublic = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );

      const { error: signInError } = await supabasePublic.auth.signInWithPassword({
        email:    userData.user.email,
        password: current_password
      });

      if (signInError) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        req.userId,
        { password: new_password }
      );

      if (updateError) {
        return clientError(res, 400, 'Failed to update password', updateError);
      }

      // Invalidate all existing JWTs for this user.
      try {
        await db('users')
          .where({ id: req.userId })
          .update({ token_version: db.raw('COALESCE(token_version, 0) + 1') });
      } catch (err) {
        console.warn('token_version bump skipped:', err.message);
      }

      res.json({
        message: 'Password updated successfully. Please log in again.',
        reauth: true
      });
    } catch (error) {
      return clientError(res, 500, 'Server error', error);
    }
  });

  return router;
};