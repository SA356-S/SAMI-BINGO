const express = require('express');
const {
  requireAdmin,
  attachPanelAdmin,
  requireManager,
} = require('../middleware/adminAuth');
const settingsService = require('../services/settingsService');

const router = express.Router();

router.use(requireAdmin);
router.use(attachPanelAdmin);
router.use(requireManager);

/**
 * GET /api/settings/robot-advantage
 */
router.get('/robot-advantage', async (_req, res) => {
  try {
    const settings = await settingsService.getRobotAdvantageSettings();
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] GET robot-advantage error', err);
    res.status(500).json({ ok: false, error: 'robot_advantage_fetch_failed' });
  }
});

/**
 * PUT /api/settings/robot-advantage  { robotAdvantageLevel: 0-100 }
 */
router.put('/robot-advantage', async (req, res) => {
  try {
    const level = req.body?.robotAdvantageLevel ?? req.body?.level;
    if (level === undefined || level === null) {
      return res.status(400).json({ ok: false, error: 'robotAdvantageLevel_required' });
    }

    const settings = await settingsService.updateRobotAdvantageLevel(level);
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] PUT robot-advantage error', err);
    res.status(500).json({ ok: false, error: 'robot_advantage_update_failed' });
  }
});

/**
 * GET /api/settings/card-selection-time
 */
router.get('/card-selection-time', async (_req, res) => {
  try {
    const settings = await settingsService.getCardSelectionTimeSettings();
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] GET card-selection-time error', err);
    res.status(500).json({ ok: false, error: 'card_selection_time_fetch_failed' });
  }
});

/**
 * PUT /api/settings/card-selection-time
 * Body: { cardSelectionTime: seconds } or { seconds: number }
 */
router.put('/card-selection-time', async (req, res) => {
  try {
    const raw = req.body?.cardSelectionTime ?? req.body?.seconds;

    if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) {
      return res.status(400).json({ ok: false, error: 'cardSelectionTime_required' });
    }

    const settings = await settingsService.updateCardSelectionTime(raw);
    res.json({ ok: true, ...settings });
  } catch (err) {
    if (err?.code === 'cardSelectionTime_out_of_range') {
      return res.status(400).json({
        ok: false,
        error: 'cardSelectionTime_out_of_range',
        minSeconds: 1,
        maxSeconds: 100,
      });
    }
    console.error('[settings] PUT card-selection-time error', err);
    res.status(500).json({ ok: false, error: 'card_selection_time_update_failed' });
  }
});

/**
 * GET /api/settings/registration-bonus
 */
router.get('/registration-bonus', async (_req, res) => {
  try {
    const settings = await settingsService.getRegistrationBonusSettings();
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] GET registration-bonus error', err);
    res.status(500).json({ ok: false, error: 'registration_bonus_fetch_failed' });
  }
});

/**
 * PUT /api/settings/registration-bonus
 * Body: { registrationBonusEnabled?: boolean, registrationBonusAmount?: number }
 */
router.put('/registration-bonus', async (req, res) => {
  try {
    const enabled =
      req.body?.registrationBonusEnabled ?? req.body?.enabled;
    const amount =
      req.body?.registrationBonusAmount ?? req.body?.amount;

    if (enabled === undefined && amount === undefined) {
      return res.status(400).json({
        ok: false,
        error: 'registration_bonus_fields_required',
      });
    }

    const settings = await settingsService.updateRegistrationBonusSettings({
      enabled,
      amount,
    });
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] PUT registration-bonus error', err);
    res.status(500).json({ ok: false, error: 'registration_bonus_update_failed' });
  }
});

/**
 * GET /api/settings/first-deposit-bonus
 */
router.get('/first-deposit-bonus', async (_req, res) => {
  try {
    const settings = await settingsService.getFirstDepositBonusSettings();
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] GET first-deposit-bonus error', err);
    res.status(500).json({ ok: false, error: 'first_deposit_bonus_fetch_failed' });
  }
});

/**
 * PUT /api/settings/first-deposit-bonus
 * Body: { firstDepositBonusEnabled?: boolean, firstDepositBonusPercent?: number }
 */
router.put('/first-deposit-bonus', async (req, res) => {
  try {
    const enabled =
      req.body?.firstDepositBonusEnabled ?? req.body?.enabled;
    const percent =
      req.body?.firstDepositBonusPercent ?? req.body?.percent;

    if (enabled === undefined && percent === undefined) {
      return res.status(400).json({
        ok: false,
        error: 'first_deposit_bonus_fields_required',
      });
    }

    const settings = await settingsService.updateFirstDepositBonusSettings({
      enabled,
      percent,
    });
    res.json({ ok: true, ...settings });
  } catch (err) {
    console.error('[settings] PUT first-deposit-bonus error', err);
    res.status(500).json({ ok: false, error: 'first_deposit_bonus_update_failed' });
  }
});

module.exports = router;
