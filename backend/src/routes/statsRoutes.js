const express = require('express');
const {
  getHomeDashboard,
  getScoreDashboard,
  getHistory,
} = require('../services/statsService');
const {
  attachTelegramUserFromRequest,
  requireTelegramUserId,
} = require('../utils/telegramAuth');

const router = express.Router();

router.use(attachTelegramUserFromRequest);

/**
 * GET /api/stats/home?userId=
 * Wallet, player stats, lobby snapshot, active game, recent winners.
 */
router.get('/home', requireTelegramUserId, async (req, res) => {
  try {
    const userId = req.telegramUserId;
    const io = req.app.get('io');
    const data = await getHomeDashboard(String(userId), io);
    res.json(data);
  } catch (err) {
    console.error('[stats] home error', err);
    res.status(500).json({ ok: false, error: 'Failed to load home stats' });
  }
});

/**
 * GET /api/stats/score?userId=&period=daily|weekly
 */
router.get('/score', async (req, res) => {
  try {
    const userId = req.query.userId ?? req.headers['x-user-id'];
    const period = req.query.period === 'weekly' ? 'weekly' : 'daily';
    const data = await getScoreDashboard(
      userId ? String(userId) : null,
      period
    );
    res.json(data);
  } catch (err) {
    console.error('[stats] score error', err);
    res.status(500).json({ ok: false, error: 'Failed to load scoreboard' });
  }
});

/**
 * GET /api/stats/history?userId=
 */
router.get('/history', requireTelegramUserId, async (req, res) => {
  try {
    const userId = req.telegramUserId;
    const items = await getHistory(String(userId));
    const wins = items.filter((i) => i.type === 'victory').length;
    res.json({
      ok: true,
      summary: { totalPlayed: items.length, totalWins: wins },
      items,
    });
  } catch (err) {
    console.error('[stats] history error', err);
    res.status(500).json({ ok: false, error: 'Failed to load history' });
  }
});

module.exports = router;
