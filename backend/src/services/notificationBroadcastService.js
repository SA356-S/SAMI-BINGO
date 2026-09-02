const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mongoose } = require('../config/db');
const { NotificationModel } = require('../models/Notification');
const {
  broadcastViaTelegramBot,
  listBroadcastRecipients,
} = require('./telegramBroadcastService');

const UPLOAD_SUBDIR = 'broadcasts';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const memoryLog = [];

/** In-process broadcast jobs (single backend process). */
const broadcastJobs = new Map();
let activeBroadcastJobId = null;

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

function snapshotBroadcastJob(job) {
  if (!job) return null;
  const remaining = Math.max(0, (job.recipients || 0) - (job.sent || 0) - (job.failed || 0));
  return {
    ok: job.status !== 'failed',
    jobId: job.id,
    status: job.status,
    channel: 'telegram_bot',
    recipients: job.recipients,
    sent: job.sent,
    failed: job.failed,
    remaining,
    failedChatIds: Array.isArray(job.failedChatIds) ? job.failedChatIds.slice(0, 100) : [],
    message: job.message,
    error: job.error || undefined,
  };
}

function getActiveBroadcastJob() {
  if (activeBroadcastJobId && broadcastJobs.has(activeBroadcastJobId)) {
    return broadcastJobs.get(activeBroadcastJobId);
  }
  return null;
}

function getBroadcastJob(jobId) {
  const id = String(jobId || '').trim();
  if (id) {
    if (broadcastJobs.has(id)) {
      return snapshotBroadcastJob(broadcastJobs.get(id));
    }
    return null;
  }
  const active = getActiveBroadcastJob();
  if (active) return snapshotBroadcastJob(active);
  return null;
}

function runBroadcastJob(job, payload) {
  void broadcastViaTelegramBot(
    {
      imageUrl: payload.imageUrl,
      message: payload.message,
      buttonText: payload.buttonText,
      buttonLink: payload.buttonLink,
      recipients: payload.recipients,
    },
    {
      onProgress: (progress) => {
        job.sent = progress.sent;
        job.failed = progress.failed;
        job.failedChatIds = progress.failedChatIds;
        job.recipients = progress.recipients;
        job.message = `Sending… ${progress.sent} sent, ${progress.failed} failed`;
      },
    }
  )
    .then((result) => {
      if (!result.ok) {
        job.status = 'failed';
        job.error = result.error;
        job.message = result.message || 'Broadcast failed';
        return;
      }
      job.sent = result.sent;
      job.failed = result.failed;
      job.failedChatIds = result.failedChatIds;
      job.recipients = result.recipients;
      job.status = 'completed';
      job.message = `Delivered via Telegram bot to ${result.sent} chat(s)`;
    })
    .catch((err) => {
      job.status = 'failed';
      job.error = 'broadcast_failed';
      job.message = err?.message || 'Broadcast failed';
      console.error('[notifications] background broadcast error:', err);
    })
    .finally(() => {
      if (activeBroadcastJobId === job.id) {
        activeBroadcastJobId = null;
      }
    });
}

async function broadcastNotification(input, req) {
  const message = String(input.message ?? '').trim();
  if (!message) {
    return { ok: false, error: 'message_required', message: 'Message is required' };
  }

  const active = getActiveBroadcastJob();
  if (active && active.status === 'sending') {
    return {
      ...snapshotBroadcastJob(active),
      ok: false,
      error: 'broadcast_in_progress',
      message: 'A broadcast is already sending. Wait for it to finish.',
    };
  }

  if (!String(process.env.BOT_TOKEN || '').trim()) {
    return {
      ok: false,
      error: 'bot_not_configured',
      message: 'BOT_TOKEN is not set — cannot send Telegram messages',
    };
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

  const recipients = await listBroadcastRecipients();
  if (!recipients.length) {
    return {
      ok: false,
      error: 'no_recipients',
      message: 'No Telegram users with chatId found in database',
    };
  }

  const job = {
    id: crypto.randomUUID(),
    status: 'sending',
    recipients: recipients.length,
    sent: 0,
    failed: 0,
    remaining: recipients.length,
    failedChatIds: [],
    message: `Broadcast started — ${recipients.length} recipient(s)`,
    error: null,
    createdAt: Date.now(),
  };
  broadcastJobs.set(job.id, job);
  activeBroadcastJobId = job.id;

  runBroadcastJob(job, {
    imageUrl,
    message,
    buttonText,
    buttonLink,
    recipients,
  });

  return snapshotBroadcastJob(job);
}

module.exports = {
  uploadBroadcastImage,
  broadcastNotification,
  getBroadcastJob,
  resolvePublicBaseUrl,
  toAbsoluteImageUrl,
};
