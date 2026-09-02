const express = require('express');
const {
  verifyAndCreditDeposit,
  getDepositErrorMessage,
} = require('../services/depositVerificationService');

const router = express.Router();

const VERIFY_SECRET = process.env.BOT_DEPOSIT_VERIFY_SECRET || '';

/**
 * POST /bot/deposit/verify
 * Optional HTTP entry for the Telegram bot. Uses the same qbirr verification service
 * as the Mini App. Prefer in-process verifyAndCreditDeposit from depositHandler.
 */
router.post('/deposit/verify', async (req, res) => {
  try {
    if (VERIFY_SECRET) {
      const provided =
        req.headers['x-bot-deposit-secret'] || req.headers['x-bot-secret'] || '';
      if (String(provided) !== String(VERIFY_SECRET)) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
    }

    const body = req.body || {};
    const result = await verifyAndCreditDeposit({
      userId: body.userId,
      provider: body.provider || body.paymentMethod,
      reference: body.reference || body.transactionId || body.ref,
      amount: body.amount || body.submittedAmount,
      receivingNumber: body.receivingNumber || body.number,
      source: 'bot',
    });

    if (!result.ok) {
      const status = result.error === 'transaction_already_processed' ? 409 : 400;
      return res.status(status).json({
        ok: false,
        error: result.error,
        message: getDepositErrorMessage(result.error, 'am'),
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('[botDeposit] verify error:', err?.message || err);
    res.status(500).json({ ok: false, error: 'verification_failed' });
  }
});

router.verifyAndCreditDeposit = verifyAndCreditDeposit;

module.exports = router;
