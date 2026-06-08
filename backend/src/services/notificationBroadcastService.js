const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mongoose } = require('../config/db');
const { NotificationModel } = require('../models/Notification');
const { broadcastViaTelegramBot } = require('./telegramBroadcastService');

const UPLOAD_SUBDIR = 'broadcasts';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const memoryLog = [];

function getUploadsDir() {
  return path.join(__dirname, '../../public/uploads', UPLOAD_SUBDIR);
}

function ensureUploadsDir() {
  const dir = getUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolvePublicBaseUrl(req) {
  const fromEnv = String(process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host) return `${proto}://${host}`.replace(/\/$/, '');
  }
  const port = Number(process.env.PORT) || 3001;
  return `http://localhost:${port}`;
}

function toAbsoluteImageUrl(imageUrl, req) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  const base = resolvePublicBaseUrl(req);
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

async function saveNotificationLog(data) {
  const doc = {
    imageUrl: data.imageUrl || '',
    message: data.message,
    buttonText: data.buttonText || '',
    buttonLink: data.buttonLink || '',
    createdAt: new Date(),
  };

  if (mongoose.connection?.readyState === 1) {
    try {
      const saved = await NotificationModel.create(doc);
      return saved.toObject ? saved.toObject() : saved;
    } catch (err) {
      console.warn('[notifications] DB log failed:', err?.message || err);
    }
  }

  memoryLog.unshift(doc);
  if (memoryLog.length > 100) memoryLog.length = 100;
  return doc;
}

async function uploadBroadcastImage({ imageBase64, mimeType }, req) {
  const raw = String(imageBase64 || '').trim();
  if (!raw) {
    return { ok: false, error: 'image_required', message: 'Image data is required' };
  }

  let base64 = raw;
  let detectedMime = mimeType || 'image/jpeg';

  const dataUrlMatch = raw.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    detectedMime = dataUrlMatch[1];
    base64 = dataUrlMatch[2];
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    return { ok: false, error: 'invalid_image', message: 'Invalid image data' };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'image_too_large',
      message: 'Image must be 5MB or smaller',
    };
  }

  const ext =
    detectedMime === 'image/png'
      ? 'png'
      : detectedMime === 'image/webp'
        ? 'webp'
        : detectedMime === 'image/gif'
          ? 'gif'
          : 'jpg';

  ensureUploadsDir();
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const filePath = path.join(getUploadsDir(), filename);
  fs.writeFileSync(filePath, buffer);

  const relativeUrl = `/uploads/${UPLOAD_SUBDIR}/${filename}`;
  const imageUrl = toAbsoluteImageUrl(relativeUrl, req);

  return { ok: true, imageUrl, relativeUrl };
}

async function broadcastNotification(input, req) {
  const message = String(input.message ?? '').trim();
  if (!message) {
    return { ok: false, error: 'message_required', message: 'Message is required' };
  }

  const buttonText = String(input.buttonText ?? 'Play').trim() || 'Play';
  const buttonLink = String(input.buttonLink ?? '/card-selection').trim() || '/card-selection';
  const imageUrl = toAbsoluteImageUrl(input.imageUrl ?? '', req);

  await saveNotificationLog({
    imageUrl,
    message,
    buttonText,
    buttonLink,
  });

  const telegramResult = await broadcastViaTelegramBot({
    imageUrl,
    message,
    buttonText,
    buttonLink,
  });

  if (!telegramResult.ok) {
    return telegramResult;
  }

  return {
    ok: true,
    channel: 'telegram_bot',
    recipients: telegramResult.recipients,
    sent: telegramResult.sent,
    failed: telegramResult.failed,
    failedChatIds: telegramResult.failedChatIds,
    message: `Delivered via Telegram bot to ${telegramResult.sent} chat(s)`,
  };
}

module.exports = {
  uploadBroadcastImage,
  broadcastNotification,
  resolvePublicBaseUrl,
  toAbsoluteImageUrl,
};
