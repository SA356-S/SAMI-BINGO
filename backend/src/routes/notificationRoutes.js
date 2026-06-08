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
 * POST /api/notifications/broadcast
 * Body: { imageUrl?, message, buttonText?, buttonLink? }
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
      return res.status(400).json(result);
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
