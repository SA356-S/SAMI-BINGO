/**
 * One-off diagnostic — withdraw notify recipients + Telegram sendMessage responses.
 * Does not modify application code. Safe to delete after investigation.
 */
const { loadEnv } = require('../src/config/env');
const { connectDatabase } = require('../src/config/db');
const { mongoose } = require('../src/config/db');
const { TelegramUserModel } = require('../src/models/TelegramUser');
const {
  resolveWithdrawNotifyChatIds,
} = require('../src/services/withdrawRequestNotifyService');
const {
  sendWithdrawBotMessage,
  postTelegramApi,
} = require('../src/services/telegramBotNotify');

const subscriberSchema = new mongoose.Schema(
  { chatId: String, telegramId: String, username: String },
  { collection: 'withdraw_notify_subscribers' }
);
const WithdrawNotifySubscriberModel =
  mongoose.models.DiagWithdrawNotifySubscriber ||
  mongoose.model('DiagWithdrawNotifySubscriber', subscriberSchema);

function maskToken(token) {
  const t = String(token || '');
  if (t.length < 12) return t ? '(set, short)' : '(missing)';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function collectEnvBreakdown() {
  const keys = [
    'WITHDRAW_ADMIN_CHAT_ID',
    'ADMIN_CHAT_ID',
    'WITHDRAW_NOTIFY_CHAT_ID',
    'BOOTSTRAP_MANAGER_TELEGRAM_ID',
  ];
  const breakdown = {};
  const merged = new Set();
  for (const key of keys) {
    const raw = String(process.env[key] || '').trim();
    const parts = raw
      ? raw.split(',').map((p) => p.trim()).filter(Boolean)
      : [];
    breakdown[key] = { raw: raw || null, parsed: parts };
    for (const p of parts) merged.add(p);
  }
  return { breakdown, merged: [...merged] };
}

async function main() {
  const envPath = loadEnv();
  console.log('=== withdraw notify diagnostic ===');
  console.log('env loaded from:', envPath || '(default)');
  console.log('WITHDRAW_BOT_TOKEN:', maskToken(process.env.WITHDRAW_BOT_TOKEN));
  console.log('mongo db name (after connect):', '(pending)');

  const envPart = collectEnvBreakdown();
  console.log('\n--- env chat id sources ---');
  console.log(JSON.stringify(envPart.breakdown, null, 2));
  console.log('env merged ids:', envPart.merged);

  let finalIds = [];
  try {
    await connectDatabase();
    console.log('mongo connected:', mongoose.connection.host);
    console.log('mongo db name:', mongoose.connection.name);

    const subscribers = await WithdrawNotifySubscriberModel.find().lean();
    console.log('\n--- withdraw_notify_subscribers ---');
    console.log('count:', subscribers.length);
    console.log(JSON.stringify(subscribers, null, 2));

    const panelUsers = await TelegramUserModel.find({
      role: { $in: ['admin', 'manager'] },
      isBanned: { $ne: true },
    })
      .select('telegramId chatId role username')
      .lean();
    console.log('\n--- telegramusers admin/manager ---');
    console.log('count:', panelUsers.length);
    console.log(JSON.stringify(panelUsers, null, 2));

    finalIds = await resolveWithdrawNotifyChatIds();
  } catch (dbErr) {
    console.warn('\n--- mongo connection failed (env-only fallback) ---');
    console.warn(dbErr?.message || dbErr);
    finalIds = envPart.merged;
    console.log('fallback recipient list (env only):', finalIds);
  }

  console.log('\n--- resolveWithdrawNotifyChatIds() final list ---');
  console.log(JSON.stringify(finalIds, null, 2));

  const adminRaw = String(process.env.ADMIN_CHAT_ID || '').trim();
  const adminParts = adminRaw
    ? adminRaw.split(',').map((p) => p.trim()).filter(Boolean)
    : [];
  const adminIncluded =
    adminParts.length === 0
      ? { status: 'ADMIN_CHAT_ID empty or unset — not in env', included: [] }
      : {
          status: 'ADMIN_CHAT_ID set',
          envParts: adminParts,
          included: adminParts.map((id) => ({
            id,
            inFinalList: finalIds.includes(id),
          })),
        };
  console.log('\n--- ADMIN_CHAT_ID inclusion check ---');
  console.log(JSON.stringify(adminIncluded, null, 2));

  if (finalIds.length === 0) {
    console.log('\n--- sendWithdrawBotMessage: SKIPPED (no recipients) ---');
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
    return;
  }

  const token = String(process.env.WITHDRAW_BOT_TOKEN || '').trim();
  const probeText =
    '[diagnostic] withdraw notify probe — ignore (script test, not a real request)';

  console.log('\n--- sendWithdrawBotMessage() per recipient ---');
  for (const chatId of finalIds) {
    console.log(`\n>> chatId: ${chatId}`);
    console.log('>> calling sendWithdrawBotMessage()...');
    const viaService = await sendWithdrawBotMessage(chatId, probeText);
    console.log('>> sendWithdrawBotMessage return value:', JSON.stringify(viaService, null, 2));

    console.log('>> calling postTelegramApi sendMessage (full raw response)...');
    const raw = await postTelegramApi(
      token,
      'sendMessage',
      { chat_id: String(chatId), text: probeText },
      'withdraw-bot-diagnostic'
    );
    console.log('>> postTelegramApi return value:', JSON.stringify(raw, null, 2));
  }

  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  console.log('\n=== done ===');
}

main().catch((err) => {
  console.error('diagnostic failed:', err?.message || err);
  process.exit(1);
});
