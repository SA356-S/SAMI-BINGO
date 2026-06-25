const express = require('express');
const {
  getProfileData,
  setSoundEffects,
} = require('../services/profileService');
const {
  attachTelegramUserFromRequest,
  requireTelegramUserId,
} = require('../utils/telegramAuth');

const router = express.Router();

router.use(attachTelegramUserFromRequest);

/**
 * GET /api/profile?userId=
 */
router.get('/', requireTelegramUserId, async (req, res) => {
  try {
    const userId = req.telegramUserId;
    const initUser = req.telegramUserFromInit;

    const data = await getProfileData(String(userId), {
      phone: req.query.phone,
      inviteCode: req.query.inviteCode,
      firstName: req.query.firstName ?? initUser?.first_name,
      lastName: req.query.lastName ?? initUser?.last_name,
      username: req.query.username ?? initUser?.username,
      telegramId: userId,
      initData: req.headers['x-telegram-init-data'],
    });

    console.log('[telegram] profile API', {
      userId,
      username: data.username,
      phone: data.phone ? '(set)' : '(empty)',
    });

    res.json(data);
  } catch (err) {
    console.error('[profile] GET error', err);
    res.status(500).json({ ok: false, error: 'Failed to load profile' });
  }
});

/**
 * PATCH /api/profile/settings  { soundEffectsEnabled }
 */
router.patch('/settings', requireTelegramUserId, async (req, res) => {
  try {
    const userId = req.telegramUserId;

    if ('soundEffectsEnabled' in req.body) {
      const enabled = await setSoundEffects(
        String(userId),
        req.body.soundEffectsEnabled
      );
      const data = await getProfileData(String(userId));
      return res.json({
        ...data,
        soundEffectsEnabled: enabled,
      });
    }

    res.status(400).json({ ok: false, error: 'No settings to update' });
  } catch (err) {
    console.error('[profile] PATCH settings error', err);
    res.status(500).json({ ok: false, error: 'Failed to update settings' });
  }
});

module.exports = router;
