const express = require('express');
const {
  requireAdmin,
  attachPanelAdmin,
  requireAdminOrManager,
} = require('../middleware/adminAuth');
const notificationBroadcastService = require('../services/notificationBroadcastService');

const router = express.Router();

router.use(requireAdmin);
router.use(attachPanelAdmin);
router.use(requireAdminOrManager);

/**
 * POST /api/notifications/upload-image
 * Body: { imageBase64, mimeType? }
 */
router.post('/upload-image', async (req, res) => {
  try {
    const result = await notificationBroadcastService.uploadBroadcastImage(
      {
        imageBase64: req.body?.imageBase64 ?? req.body?.image,
        mimeType: req.body?.mimeType,
      },
      req
    );
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[notifications] upload-image error:', err);
    res.status(500).json({
      ok: false,
      error: 'upload_failed',
      message: err?.message || 'Image upload failed',
    });
  }
});

/**
 * GET /api/notifications/broadcast/status
 * Query: jobId? — live progress for the active or specified job
 */
router.get('/broadcast/status', (req, res) => {
  const snapshot = notificationBroadcastService.getBroadcastJob(req.query?.jobId);
  if (!snapshot) {
    return res.status(404).json({
      ok: false,
      error: 'job_not_found',
      message: 'No broadcast job found',
    });
  }
  res.json(snapshot);
});

/**
 * POST /api/notifications/broadcast
 * Body: { imageUrl?, message, buttonText?, buttonLink? }
 * Starts sending in the background and returns immediately with live job stats.
 */
router.post('/broadcast', async (req, res) => {
  try {
    const result = await notificationBroadcastService.broadcastNotification(
      {
        imageUrl: req.body?.imageUrl,
        message: req.body?.message,
        buttonText: req.body?.buttonText,
        buttonLink: req.body?.buttonLink,
      },
      req
    );

    if (!result.ok) {
      const status = result.error === 'broadcast_in_progress' ? 409 : 400;
      return res.status(status).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('[notifications] broadcast error:', err);
    res.status(500).json({
      ok: false,
      error: 'broadcast_failed',
      message: err?.message || 'Broadcast failed',
    });
  }
});

module.exports = router;
