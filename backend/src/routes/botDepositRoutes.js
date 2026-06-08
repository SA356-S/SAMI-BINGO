const express = require('express');
const { verifyAndApproveDeposit } = require('../services/botDepositService');

const router = express.Router();

const VERIFY_SECRET = process.env.BOT_DEPOSIT_VERIFY_SECRET || '';

/**
 * POST /bot/deposit/verify
 * Bot deposit verification + safe auto-approval.
 */
router.post('/deposit/verify', async (req, res) => {
  try {
    if (VERIFY_SECRET) {
      const provided =
        req.headers['x-bot-deposit-secret'] ||
        req.headers['x-bot-secret'] ||
        '';
      if (String(provided) !== String(VERIFY_SECRET)) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
    }

    const {
      userId,
      paymentMethod,
      rawProofText,
      message,
    } = req.body || {};

    const result = await verifyAndApproveDeposit({
      userId,
      rawProofText: rawProofText || message,
      paymentMethod: paymentMethod || 'telebirr',
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error('[botDeposit] verify error:', err?.message || err);
    res.status(500).json({ ok: false, error: 'deposit_verification_failed' });
  }
});

module.exports = router;

