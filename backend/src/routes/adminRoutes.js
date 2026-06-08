const express = require('express');
const {
  requireAdmin,
  attachPanelAdmin,
  requireManager,
  requireAdminOrManager,
  ADMIN_TOKEN,
} = require('../middleware/adminAuth');
const userRoleService = require('../services/userRoleService');
const {
  getDashboardSnapshot,
  getDashboardSnapshotAsync,
  emitRobotsSnapshot,
  sessionSnapshot,
  resolveSession,
  listRecentPayments,
  startGame,
  stopGame,
  drawNumber,
  resetGame,
} = require('../services/adminService');
const {
  listWithdrawRequests,
  updateWithdrawStatus,
  emitWithdrawRequestsUpdate,
} = require('../services/withdrawAdminService');

const robotManagementService = require('../services/robotManagementService');
const robotConfigService = require('../services/robotConfigService');
const robotStatsService = require('../services/robotStatsService');

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

router.post('/login', async (req, res) => {
  const password = String(req.body?.password || '');
  const telegramId = userRoleService.parseTelegramId(
    req.body?.telegramId ?? req.body?.telegram_id
  );

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      ok: false,
      error: 'invalid_credentials',
      message: 'Invalid password',
    });
  }

  if (!telegramId) {
    return res.status(400).json({
      ok: false,
      error: 'telegram_id_required',
      message: 'Telegram ID is required for admin login',
    });
  }

  try {
    await userRoleService.bootstrapManagerIfNeeded(telegramId);
    const login = await userRoleService.resolvePanelLogin(telegramId);
    if (!login.ok) {
      const status =
        login.error === 'user_not_found'
          ? 404
          : login.error === 'not_authorized'
            ? 403
            : 400;
      return res.status(status).json(login);
    }

    res.json({
      ok: true,
      token: ADMIN_TOKEN,
      role: login.role,
      telegramId: login.telegramId,
      user: login.user,
      expiresIn: 86400,
    });
  } catch (err) {
    console.error('[admin] login error', err);
    res.status(500).json({ ok: false, error: 'login_failed' });
  }
});

router.post('/internal/broadcast-withdraw-requests', requireAdmin, async (_req, res) => {
  try {
    const result = await emitWithdrawRequestsUpdate();
    res.json(result);
  } catch (err) {
    console.error('[admin] internal withdraw broadcast error', err);
    res.status(500).json({ ok: false, error: 'broadcast_failed' });
  }
});

router.use(requireAdmin);
router.use(attachPanelAdmin);

router.get('/me', (req, res) => {
  res.json({
    ok: true,
    role: req.panelAdmin?.role,
    telegramId: req.panelAdmin?.telegramId,
    user: req.panelAdmin?.user,
  });
});

router.get('/dashboard', requireManager, async (_req, res) => {
  try {
    res.json(await getDashboardSnapshotAsync());
  } catch (err) {
    console.error('[admin] dashboard error', err);
    res.json(getDashboardSnapshot());
  }
});

router.get('/daily-profit', requireManager, async (_req, res) => {
  try {
    const { getDailyProfitSummary } = require('../services/dailyProfitService');
    res.json(await getDailyProfitSummary());
  } catch (err) {
    console.error('[admin] daily-profit error', err);
    res.status(500).json({ ok: false, error: 'daily_profit_failed' });
  }
});

router.get('/game/state', requireManager, (req, res) => {
  const session = resolveSession(req.query.gameId);
  res.json({ ok: true, game: sessionSnapshot(session) });
});

router.post('/game/start', requireManager, (req, res) => {
  const result = startGame(req.body?.gameId, {
    forceStart: req.body?.forceStart !== false,
  });
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post('/game/stop', requireManager, (req, res) => {
  const result = stopGame(req.body?.gameId);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post('/game/draw', requireManager, (req, res) => {
  const result = drawNumber(req.body?.gameId);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.post('/game/reset', requireManager, (req, res) => {
  const result = resetGame(req.body?.gameId);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

router.get('/players', requireManager, (req, res) => {
  const session = resolveSession(req.query.gameId);
  const players = session.buildPlayersList();
  const active = players.filter((p) => p.status === 'active');
  res.json({
    ok: true,
    total: players.length,
    active: active.length,
    players,
  });
});

router.get('/cartelas', requireManager, (req, res) => {
  const session = resolveSession(req.query.gameId);
  const snapshot = sessionSnapshot(session);
  res.json({
    ok: true,
    soldCount: snapshot.soldCartelasCount,
    cartelas: snapshot.cartelas,
    takenCartels: [...session.takenCartels],
  });
});

router.get('/payments', requireManager, async (_req, res) => {
  try {
    const data = await listRecentPayments(100);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[admin] payments error', err);
    res.status(500).json({ ok: false, error: 'payments_failed' });
  }
});

router.get('/withdraw-requests', requireAdminOrManager, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await listWithdrawRequests({ status, limit: 100 });
    res.json(data);
  } catch (err) {
    console.error('[admin] withdraw-requests list error', err);
    res.status(500).json({ ok: false, error: 'withdraw_requests_failed' });
  }
});

router.post('/withdraw-requests/:id/approve', requireAdminOrManager, async (req, res) => {
  try {
    const result = await updateWithdrawStatus(req.params.id, 'approved', {
      actorTelegramId: req.panelAdmin?.telegramId,
    });
    if (!result.ok) {
      const status =
        result.error === 'already_processed'
          ? 409
          : result.error === 'not_authorized'
            ? 403
            : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[admin] withdraw approve error', err);
    res.status(500).json({ ok: false, error: 'withdraw_approve_failed' });
  }
});

router.post('/withdraw-requests/:id/reject', requireAdminOrManager, async (req, res) => {
  try {
    const result = await updateWithdrawStatus(req.params.id, 'rejected', {
      actorTelegramId: req.panelAdmin?.telegramId,
    });
    if (!result.ok) {
      const status =
        result.error === 'already_processed'
          ? 409
          : result.error === 'not_authorized'
            ? 403
            : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[admin] withdraw reject error', err);
    res.status(500).json({ ok: false, error: 'withdraw_reject_failed' });
  }
});

/**
 * Robot management (fair simulated activity).
 */
router.get('/robots', requireManager, async (_req, res) => {
  try {
    const snapshot = await require('../services/adminService').getRobotsSnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error('[admin] robots list error', err);
    res.status(500).json({ ok: false, error: 'robots_failed' });
  }
});

router.post('/robots', requireManager, async (req, res) => {
  try {
    const name = req.body?.name ?? req.body?.robotName;
    const result = await robotManagementService.createRobot(name);
    if (!result.ok) {
      const status =
        result.error === 'name_required' || result.error === 'name_too_long'
          ? 400
          : result.error === 'name_duplicate'
            ? 409
            : 400;
      return res.status(status).json({
        ok: false,
        error: result.error,
        message: result.message || result.error,
      });
    }
    try {
      await emitRobotsSnapshot();
    } catch (emitErr) {
      console.warn('[admin] robots snapshot emit after create failed:', emitErr?.message || emitErr);
    }
    res.status(201).json({
      ok: true,
      robot: result.robot,
      message: 'Robot created',
    });
  } catch (err) {
    console.error('[admin] robots create error', err);
    res.status(500).json({
      ok: false,
      error: 'robots_create_failed',
      message: err?.message || 'Failed to create robot',
    });
  }
});

router.patch('/robots/:robotId', requireManager, async (req, res) => {
  try {
    const { robotId } = req.params;
    let nextStatus = req.body?.status;

    if (nextStatus == null && req.body?.enabled != null) {
      nextStatus = req.body.enabled ? 'on' : 'off';
    }

    if (nextStatus == null) {
      res.status(400).json({ ok: false, error: 'missing_status' });
      return;
    }

    const result = await robotManagementService.setRobotStatus(robotId, nextStatus);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    await emitRobotsSnapshot();
    res.json({ ok: true, robot: result.robot });
  } catch (err) {
    console.error('[admin] robots toggle error', err);
    res.status(500).json({ ok: false, error: 'robots_toggle_failed' });
  }
});

router.get('/robots/stats', requireManager, async (_req, res) => {
  try {
    const stats = await robotStatsService.listAllRobotStats();
    res.json({ ok: true, stats });
  } catch (err) {
    console.error('[admin] robots stats error', err);
    res.status(500).json({ ok: false, error: 'robots_stats_failed' });
  }
});

router.put('/robots/config', requireManager, async (req, res) => {
  try {
    const patch = req.body || {};
    const updated = await robotConfigService.updateConfig(patch);
    await emitRobotsSnapshot();
    res.json({ ok: true, config: updated });
  } catch (err) {
    console.error('[admin] robots config error', err);
    res.status(500).json({ ok: false, error: 'robots_config_failed' });
  }
});

router.post('/robots/bank/topup', requireManager, async (req, res) => {
  try {
    const amount = Number(req.body?.amount ?? req.body?.value);
    const updated = await robotConfigService.topupBank(amount);
    await emitRobotsSnapshot();
    res.json({ ok: true, config: updated });
  } catch (err) {
    console.error('[admin] robots bank topup error', err);
    res.status(500).json({ ok: false, error: 'robots_bank_topup_failed' });
  }
});

module.exports = router;
