const { mongoose } = require('../config/db');
const { TelegramUserModel } = require('../models/TelegramUser');
const { sendWithdrawBotMessage, editWithdrawBotMessage } = require('./telegramBotNotify');
const { formatWithdrawRequestNotification } = require('./withdrawAdminService');
const { buildWithdrawActionKeyboard } = require('./withdrawBotAdminHandlers');

const subscriberSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true },
    telegramId: { type: String, default: '' },
    username: { type: String, default: '' },
  },
  { timestamps: true, collection: 'withdraw_notify_subscribers' }
);

const notifyMessageSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, index: true },
    chatId: { type: String, required: true },
    messageId: { type: Number, required: true },
  },
  { timestamps: true, collection: 'withdraw_notify_messages' }
);

const WithdrawNotifySubscriberModel =
  mongoose.models.WithdrawNotifySubscriber ||
  mongoose.model('WithdrawNotifySubscriber', subscriberSchema);

const WithdrawNotifyMessageModel =
  mongoose.models.WithdrawNotifyMessage ||
  mongoose.model('WithdrawNotifyMessage', notifyMessageSchema);

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function resolveRequestId(request = {}) {
  return String(request._id ?? request.id ?? '').trim();
}

function collectEnvChatIds() {
  const ids = new Set();
  const envKeys = [
    'WITHDRAW_ADMIN_CHAT_ID',
    'ADMIN_CHAT_ID',
    'WITHDRAW_NOTIFY_CHAT_ID',
  ];

  for (const key of envKeys) {
    const raw = String(process.env[key] || '').trim();
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const id = part.trim();
      if (id) ids.add(id);
    }
  }

  const bootstrap = String(process.env.BOOTSTRAP_MANAGER_TELEGRAM_ID || '').trim();
  if (bootstrap) ids.add(bootstrap);

  return ids;
}

/** Called when an admin opens the withdraw notification bot and sends /start. */
async function registerWithdrawNotifyChat({ chatId, telegramId, username }) {
  const id = String(chatId || '').trim();
  if (!id) return { ok: false, error: 'missing_chat_id' };

  if (isDbReady()) {
    await WithdrawNotifySubscriberModel.findOneAndUpdate(
      { chatId: id },
      {
        chatId: id,
        telegramId: String(telegramId || id),
        username: String(username || ''),
      },
      { upsert: true, new: true }
    );
    console.log('[withdraw-bot] registered notify subscriber', { chatId: id, username });
  }

  return { ok: true, chatId: id };
}

async function resolveWithdrawNotifyChatIds() {
  const ids = collectEnvChatIds();

  if (isDbReady()) {
    const subscribers = await WithdrawNotifySubscriberModel.find()
      .select('chatId')
      .lean();
    for (const row of subscribers) {
      if (row?.chatId) ids.add(String(row.chatId));
    }

    const panelUsers = await TelegramUserModel.find({
      role: { $in: ['admin', 'manager'] },
      isBanned: { $ne: true },
    })
      .select('telegramId chatId')
      .lean();

    for (const user of panelUsers) {
      const chatId = user.chatId || user.telegramId;
      if (chatId != null) ids.add(String(chatId));
    }
  }

  return [...ids];
}

async function storeNotifyMessageRef(requestId, chatId, messageId) {
  if (!isDbReady() || !requestId || !chatId || !messageId) return;

  await WithdrawNotifyMessageModel.findOneAndUpdate(
    { requestId, chatId: String(chatId) },
    { requestId, chatId: String(chatId), messageId: Number(messageId) },
    { upsert: true, new: true }
  );
}

async function syncWithdrawBotMessagesForRequest(request = {}) {
  const requestId = resolveRequestId(request);
  if (!requestId) return { ok: false, error: 'missing_request_id' };

  const withdrawBotToken = String(process.env.WITHDRAW_BOT_TOKEN || '').trim();
  if (!withdrawBotToken) {
    return { ok: false, skipped: 'missing_token' };
  }

  const text = formatWithdrawRequestNotification(request);
  const emptyKeyboard = { inline_keyboard: [] };

  if (isDbReady()) {
    const refs = await WithdrawNotifyMessageModel.find({ requestId }).lean();
    if (refs.length > 0) {
      const results = await Promise.all(
        refs.map(async (ref) => {
          const edited = await editWithdrawBotMessage(
            ref.chatId,
            ref.messageId,
            text,
            emptyKeyboard
          );
          return { chatId: ref.chatId, messageId: ref.messageId, ok: edited.ok };
        })
      );
      return { ok: true, updated: results.filter((row) => row.ok).length, total: results.length };
    }
  }

  const chatIds = await resolveWithdrawNotifyChatIds();
  if (chatIds.length === 0) {
    return { ok: false, skipped: 'no_recipients' };
  }

  const results = await Promise.all(
    chatIds.map(async (chatId) => {
      const sent = await sendWithdrawBotMessage(chatId, text, emptyKeyboard);
      return { chatId, ok: sent.ok };
    })
  );

  return {
    ok: true,
    fallback: true,
    updated: results.filter((row) => row.ok).length,
    total: results.length,
  };
}

async function notifyWithdrawRequestCreated(request) {
  if (!request) return { ok: false, skipped: 'no_request' };

  const requestId = resolveRequestId(request);
  if (!requestId) return { ok: false, skipped: 'missing_request_id' };

  const withdrawBotToken = String(process.env.WITHDRAW_BOT_TOKEN || '').trim();
  if (!withdrawBotToken) {
    console.warn('[withdraw-bot] WITHDRAW_BOT_TOKEN is not set');
    return { ok: false, skipped: 'missing_token' };
  }

  console.log('Sending withdraw notification to bot...', {
    userId: request.userId,
    amount: request.amount,
    requestId,
  });

  const text = formatWithdrawRequestNotification({ ...request, status: 'pending' });
  const replyMarkup = buildWithdrawActionKeyboard(requestId);
  const chatIds = await resolveWithdrawNotifyChatIds();

  if (chatIds.length === 0) {
    console.warn(
      '[withdraw-bot] notify skipped — no admin chat ids. Set ADMIN_CHAT_ID or WITHDRAW_ADMIN_CHAT_ID, or send /start to the withdraw bot.'
    );
    return { ok: false, skipped: 'no_recipients' };
  }

  console.log('[withdraw-bot] notify recipients', chatIds);

  const results = await Promise.all(
    chatIds.map(async (chatId) => {
      const sent = await sendWithdrawBotMessage(chatId, text, replyMarkup);
      if (sent.ok && sent.result?.message_id) {
        await storeNotifyMessageRef(requestId, chatId, sent.result.message_id);
      }
      return { chatId, ok: sent.ok };
    })
  );

  const sentCount = results.filter((row) => row.ok).length;
  if (sentCount === 0) {
    console.warn('[withdraw-bot] notify failed for all recipients', results);
    return { ok: false, error: 'send_failed', recipients: results };
  }

  console.log('[withdraw-bot] notify sent', { sentCount, total: chatIds.length });
  return { ok: true, sentCount, recipients: results };
}

module.exports = {
  notifyWithdrawRequestCreated,
  registerWithdrawNotifyChat,
  resolveWithdrawNotifyChatIds,
  syncWithdrawBotMessagesForRequest,
};
