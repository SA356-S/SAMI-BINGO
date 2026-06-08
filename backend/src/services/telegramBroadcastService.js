const fs = require('fs');
const path = require('path');
const { Telegraf, Input } = require('telegraf');
const { mongoose } = require('../config/db');
const { TelegramUserModel } = require('../models/TelegramUser');
const { getMiniAppUrl } = require('../config/miniAppUrl');

const SEND_DELAY_MS = Number(process.env.TELEGRAM_BROADCAST_DELAY_MS) || 40;
const MAX_RETRIES = Number(process.env.TELEGRAM_BROADCAST_RETRIES) || 3;

/** @type {import('telegraf').Telegram | null} */
let telegramApi = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTelegramApi() {
  if (telegramApi) return telegramApi;
  const token = String(process.env.BOT_TOKEN || '').trim();
  if (!token) return null;
  telegramApi = new Telegraf(token).telegram;
  return telegramApi;
}

function resolveChatId(user) {
  const id = user?.chatId ?? user?.telegramId;
  if (id == null) return null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function resolveButtonUrl(buttonLink) {
  const raw = String(buttonLink || '').trim();
  if (!raw) return getMiniAppUrl();
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const base = getMiniAppUrl().replace(/\/$/, '');
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

/**
 * Inline keyboard with web_app button — opens the Mini App inside Telegram (not external browser).
 */
function buildReplyMarkup(buttonText, buttonLink) {
  const text = String(buttonText || 'Play').trim() || 'Play';
  const url = resolveButtonUrl(buttonLink);
  return {
    inline_keyboard: [[{ text, web_app: { url } }]],
  };
}

function resolveLocalImagePath(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;

  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const u = new URL(raw);
      if (u.pathname.startsWith('/uploads/')) {
        const rel = u.pathname.replace(/^\/uploads\//, '');
        const local = path.join(__dirname, '../../public/uploads', rel);
        if (fs.existsSync(local)) return local;
      }
      return null;
    }
  } catch {
    /* not a URL */
  }

  if (raw.startsWith('/uploads/')) {
    const rel = raw.replace(/^\/uploads\//, '');
    const local = path.join(__dirname, '../../public/uploads', rel);
    if (fs.existsSync(local)) return local;
  }

  return null;
}

function resolvePhotoInput(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;

  const local = resolveLocalImagePath(raw);
  if (local) {
    return Input.fromLocalFile(local);
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return null;
}

function getTelegramError(err) {
  return err?.response ?? err?.on?.payload ?? err;
}

function isRetryableTelegramError(err) {
  const code = getTelegramError(err)?.error_code;
  return code === 429 || code === 500 || code === 502 || code === 503;
}

function retryAfterMs(err) {
  const sec = getTelegramError(err)?.parameters?.retry_after;
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return 2000;
}

async function sendTelegramPayload(chatId, payload, sendFn) {
  const api = getTelegramApi();
  if (!api) {
    throw new Error('BOT_TOKEN is not configured');
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await sendFn(api, chatId, payload);
      return { ok: true };
    } catch (err) {
      lastErr = err;
      const tg = getTelegramError(err);
      if (tg?.error_code === 403) {
        return { ok: false, error: 'blocked', message: tg.description };
      }
      if (tg?.error_code === 400) {
        return { ok: false, error: 'bad_request', message: tg.description };
      }
      if (isRetryableTelegramError(err) && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(err));
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    error: 'send_failed',
    message: getTelegramError(lastErr)?.description || lastErr?.message || 'send_failed',
  };
}

async function sendBroadcastToChat(chatId, { imageUrl, message, buttonText, buttonLink }) {
  const caption = String(message || '').trim().slice(0, 1024);
  const reply_markup = buildReplyMarkup(buttonText, buttonLink);
  const photo = resolvePhotoInput(imageUrl);

  if (photo) {
    return sendTelegramPayload(chatId, { photo, caption, reply_markup }, async (api, id, p) => {
      await api.sendPhoto(id, p.photo, {
        caption: p.caption,
        reply_markup: p.reply_markup,
      });
    });
  }

  return sendTelegramPayload(chatId, { message: caption, reply_markup }, async (api, id, p) => {
    await api.sendMessage(id, p.message, {
      reply_markup: p.reply_markup,
      disable_web_page_preview: false,
    });
  });
}

async function listBroadcastRecipients() {
  if (mongoose.connection?.readyState !== 1) {
    return [];
  }

  const users = await TelegramUserModel.find({
    $or: [{ chatId: { $exists: true, $ne: null } }, { telegramId: { $exists: true, $ne: null } }],
  })
    .select('telegramId chatId username firstName')
    .lean();

  const seen = new Set();
  const out = [];

  for (const user of users) {
    const chatId = resolveChatId(user);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    out.push({ chatId, telegramId: user.telegramId, username: user.username });
  }

  return out;
}

/**
 * Send admin broadcast to every Telegram user via Bot API (not Mini App / WebSocket).
 */
async function broadcastViaTelegramBot({ imageUrl, message, buttonText, buttonLink }) {
  if (!getTelegramApi()) {
    return {
      ok: false,
      error: 'bot_not_configured',
      message: 'BOT_TOKEN is not set — cannot send Telegram messages',
    };
  }

  const recipients = await listBroadcastRecipients();
  if (!recipients.length) {
    return {
      ok: false,
      error: 'no_recipients',
      message: 'No Telegram users with chatId found in database',
    };
  }

  const results = {
    sent: 0,
    failed: 0,
    failedChatIds: [],
  };

  for (const user of recipients) {
    const result = await sendBroadcastToChat(user.chatId, {
      imageUrl,
      message,
      buttonText,
      buttonLink,
    });

    if (result.ok) {
      results.sent += 1;
    } else {
      results.failed += 1;
      results.failedChatIds.push({
        chatId: user.chatId,
        error: result.error,
        message: result.message,
      });
      console.warn('[notifications] Telegram send failed', {
        chatId: user.chatId,
        error: result.error,
        message: result.message,
      });
    }

    if (SEND_DELAY_MS > 0) {
      await sleep(SEND_DELAY_MS);
    }
  }

  console.info('[notifications] Telegram bot broadcast finished', {
    total: recipients.length,
    sent: results.sent,
    failed: results.failed,
  });

  return {
    ok: true,
    channel: 'telegram_bot',
    recipients: recipients.length,
    sent: results.sent,
    failed: results.failed,
    failedChatIds: results.failedChatIds,
  };
}

module.exports = {
  broadcastViaTelegramBot,
  listBroadcastRecipients,
  sendBroadcastToChat,
  resolveChatId,
  resolveButtonUrl,
};
