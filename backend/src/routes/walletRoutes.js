const express = require('express');
const { getWalletPageData } = require('../services/walletTransactionService');
const {
  attachTelegramUserFromRequest,
  requireTelegramUserId,
} = require('../utils/telegramAuth');

const router = express.Router();

router.use(attachTelegramUserFromRequest);

/**
 * GET /api/wallet?userId=
 * Balances, phone, and deposit/withdraw transaction history.
 */
router.get('/', requireTelegramUserId, async (req, res) => {
  try {
    const userId = req.telegramUserId;
    const initUser = req.telegramUserFromInit;

    const data = await getWalletPageData(String(userId), {
      phone: req.query.phone,
      telegramId: userId,
      firstName: req.query.firstName ?? initUser?.first_name,
      lastName: req.query.lastName ?? initUser?.last_name,
      username: req.query.username ?? initUser?.username,
      initData: req.headers['x-telegram-init-data'],
    });

    console.log('[telegram] wallet API', {
      userId,
      phone: data.phone ? '(set)' : '(empty)',
      verified: data.verified,
    });

    res.json(data);
  } catch (err) {
    console.error('[wallet] GET error', err);
    res.status(500).json({ ok: false, error: 'Failed to load wallet' });
  }
});

module.exports = router;
