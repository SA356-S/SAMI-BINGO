const express = require('express');
const { getProfileData } = require('../services/profileService');
const { getWalletPageData } = require('../services/walletTransactionService');
const { syncClientTelegramIdentity } = require('../services/profileService');
const {
  attachTelegramUserFromRequest,
  requireTelegramUserId,
} = require('../utils/telegramAuth');
const { rejectIfBanned } = require('../utils/banGate');
const userRoleService = require('../services/userRoleService');

const router = express.Router();

router.use(attachTelegramUserFromRequest);

/**
 * POST /api/auth/session — sync Telegram user to DB and return profile + wallet.
 * Body/query may include username, firstName, lastName; initData via header.
 */
router.post('/session', requireTelegramUserId, async (req, res) => {
  try {
    const userId = req.telegramUserId;

    const banned = await rejectIfBanned(userId, res);
    if (banned) return;
    const initUser = req.telegramUserFromInit;
    const extras = {
      telegramId: userId,
      firstName: req.body?.firstName ?? req.query?.firstName ?? initUser?.first_name,
      lastName: req.body?.lastName ?? req.query?.lastName ?? initUser?.last_name,
      username: req.body?.username ?? req.query?.username ?? initUser?.username,
      initData: req.headers['x-telegram-init-data'],
    };

    await syncClientTelegramIdentity(userId, extras);

    const bootstrapped = await userRoleService.bootstrapManagerIfNeeded(userId);
    if (bootstrapped) {
      console.info('[roles] bootstrap manager assigned on session', {
        telegramId: userId,
        role: bootstrapped.role,
      });
    }

    const [profile, wallet] = await Promise.all([
      getProfileData(userId, extras),
      getWalletPageData(userId, extras),
    ]);

    console.log('[telegram] backend auth success', {
      userId,
      username: profile.username,
      phone: wallet.phone ? '(set)' : '(empty)',
    });

    res.json({
      ok: true,
      userId,
      telegramId: userId,
      profile,
      wallet,
    });
  } catch (err) {
    console.error('[telegram] auth session error', err);
    res.status(500).json({ ok: false, error: 'auth_session_failed' });
  }
});

module.exports = router;
