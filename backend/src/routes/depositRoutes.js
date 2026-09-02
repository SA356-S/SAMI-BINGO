const express = require('express');
const {
  attachTelegramUserFromRequest,
  requireTelegramUserId,
} = require('../utils/telegramAuth');
const {
  verifyAndCreditDeposit,
  getPublicDepositMethods,
  getDepositErrorMessage,
} = require('../services/depositVerificationService');

const router = express.Router();

router.use(attachTelegramUserFromRequest);

/**
 * GET /api/deposits/methods
 * Public receiving accounts for the Mini App. No secrets.
 */
router.get('/methods', requireTelegramUserId, (_req, res) => {
  res.json({ ok: true, methods: getPublicDepositMethods() });
});

/**
 * POST /api/deposits/verify
 * Mini App deposit — same verifyAndCreditDeposit service as the Telegram bot.
 */
router.post('/verify', requireTelegramUserId, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await verifyAndCreditDeposit({
      userId: req.telegramUserId,
      provider: body.provider,
      reference: body.reference || body.transactionId || body.ref,
      amount: body.amount,
      receivingNumber: body.receivingNumber || body.number,
      source: 'miniapp',
    });

    if (!result.ok) {
      const status =
        result.error === 'transaction_already_processed'
          ? 409
          : result.error === 'deposit_not_configured' ||
              result.error === 'missing_receiver_configuration'
            ? 503
            : 400;
      return res.status(status).json({
        ok: false,
        error: result.error,
        message: getDepositErrorMessage(result.error),
      });
    }

    return res.json({
      ok: true,
      credited: result.credited,
      verifiedAmount: result.verifiedAmount,
      transactionId: result.transactionId,
      provider: result.provider,
      playWallet: result.playWallet,
      firstDepositBonus: result.firstDepositBonus || 0,
    });
  } catch (err) {
    console.error('[deposit] Mini App verify error:', err?.message || err);
    return res.status(500).json({
      ok: false,
      error: 'verification_failed',
      message: getDepositErrorMessage('verification_failed'),
    });
  }
});

router.verifyAndCreditDeposit = verifyAndCreditDeposit;

module.exports = router;
