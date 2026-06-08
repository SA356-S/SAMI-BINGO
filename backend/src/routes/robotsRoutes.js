const express = require('express');
const {
  requireAdmin,
  attachPanelAdmin,
  requireManager,
} = require('../middleware/adminAuth');
const robotManagementService = require('../services/robotManagementService');
const { emitRobotsSnapshot } = require('../services/adminService');

const router = express.Router();

router.use(requireAdmin);
router.use(attachPanelAdmin);
router.use(requireManager);

/**
 * POST /api/robots/create  { name: string }
 */
router.post('/create', async (req, res) => {
  try {
    const name = req.body?.name ?? req.body?.robotName;
    const result = await robotManagementService.createRobot(name);

    if (!result.ok) {
      const status = result.error === 'name_required' ? 400 : 409;
      return res.status(status).json({
        ok: false,
        error: result.error,
        message: result.message || result.error,
      });
    }

    try {
      await emitRobotsSnapshot();
    } catch (emitErr) {
      console.warn('[robots] snapshot emit after create failed:', emitErr?.message || emitErr);
    }

    return res.status(201).json({
      ok: true,
      robot: result.robot,
      message: 'Robot created',
    });
  } catch (err) {
    console.error('[robots] POST /create error:', err);
    return res.status(500).json({
      ok: false,
      error: 'robots_create_failed',
      message: err?.message || 'Failed to create robot',
    });
  }
});

module.exports = router;
