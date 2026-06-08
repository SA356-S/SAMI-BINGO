const { Markup } = require('telegraf');
const { handleWithdrawText } = require('./withdrawHandler');
const { message } = require('telegraf/filters');
const { getEnabledPaymentMethods, getPaymentMethod } = require('../../config/paymentMethods');

/** Lazy load — avoids pulling walletManager/game stack during bot startup. */
function depositService() {
  return require('../../services/botDepositService');
}

const DEPOSIT_STATE_TTL_MS = 30 * 60 * 1000;
const depositState = new Map();

function now() {
  return Date.now();
}

function getState(userId) {
  const key = String(userId);
  const s = depositState.get(key);
  if (!s) return null;
  if (now() - s.createdAt > DEPOSIT_STATE_TTL_MS) {
    depositState.delete(key);
    return null;
  }
  return s;
}

function setState(userId, next) {
  depositState.set(String(userId), { ...next, createdAt: now() });
}

function clearState(userId) {
  depositState.delete(String(userId));
}

function pruneExpiredStates() {
  const t = now();
  for (const [k, v] of depositState.entries()) {
    if (t - v.createdAt > DEPOSIT_STATE_TTL_MS) depositState.delete(k);
  }
}

function getMethodKeyboard() {
  const methods = getEnabledPaymentMethods();
  const rows = methods.map((m) => [
    Markup.button.callback(m.label, `deposit:method:${m.name}`),
  ]);
  if (rows.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Telebirr', 'deposit:method:telebirr')],
    ]);
  }
  return Markup.inlineKeyboard(rows);
}

function formatInstructions(method) {
  const phone = method.phoneNumber || 'N/A';
  const name = method.accountName || 'N/A';
  const isCbe = String(method.name).toLowerCase().includes('cbe');

  return [
    `💰 ${method.label} ተቀማጭ`,
    '',
    `👤 ስም: ${name}`,
    `📱 ስልክ: ${phone}`,
    '',
    '1️⃣ ወደ ከላይ ያለውን አካውንት ይክፈሉ።',
    '2️⃣ የተቀበሏትን ሙሉ የክፍያ SMS (አንድ መልእክት) ይለጥፉ።',
    '',
    isCbe
      ? 'በSMS ውስጥ ካለ receipt/transaction number እና የስልክ ቁጥርዎን ያካትቱ።'
      : 'Transaction Number እና ከTelebirr የተላከው receipt linkን ያካትቱ።',
    '',
    '⚠️ ሂሳብ መቀመጥ የሚያደርገው የተረጋገጠው የክፍያ መጠን ብቻ ነው (play wallet)።',
  ].join('\n');
}

/** Shared deposit entry — inline button and /deposit command. */
async function beginDeposit(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  pruneExpiredStates();
  try {
    const { clearWithdrawState } = require('./withdrawHandler');
    clearWithdrawState(userId);
  } catch {
    /* optional */
  }
  clearState(userId);
  setState(userId, { step: 'await_amount', amount: null, paymentMethod: null });
  await ctx.reply('💰 የተቀማጭ ገንዘብ መጠን በ ETB ያስገቡ (ቁጥር ብቻ)። ለምሳሌ፡ 50');
}

async function startDeposit(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await beginDeposit(ctx);
}

async function handleAmountText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const s = getState(userId);
  if (!s || s.step !== 'await_amount') return;

  const n = Number(String(ctx.message?.text || '').trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) {
    await ctx.reply('እባክዎ ትክክለኛ መጠን ያስገቡ (ለምሳሌ 50)።');
    return;
  }

  setState(userId, { step: 'await_method', amount: n, paymentMethod: null });
  await ctx.reply(`መጠን: ${n} ETB\n\nየክፍያ አማራጭ ይምረጡ፡`, getMethodKeyboard());
}

async function chooseMethod(ctx, methodKey) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const s = getState(userId);
  if (!s || s.step !== 'await_method' || !s.amount) {
    clearState(userId);
    await ctx.reply('እንደገና ለመጀመር Deposit ቁልፍን ይንኩ።');
    return;
  }

  const cfg = getPaymentMethod(methodKey);
  await ctx.answerCbQuery().catch(() => {});
  setState(userId, {
    step: 'await_proof',
    amount: s.amount,
    paymentMethod: cfg.name,
  });
  await ctx.reply(formatInstructions(cfg));
}

async function handleProofText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const s = getState(userId);
  if (!s || s.step !== 'await_proof') return;

  const text = ctx.message?.text || '';
  if (!text || text.trim().length < 10) {
    await ctx.reply('ከTelebirr ወይም CBE Birr የተቀበሏትን ሙሉ SMS ይለጥፉ።');
    return;
  }

  await ctx.reply('⏳ ክፍያ በማረጋገጥ ላይ…');

  const { verifyAndApproveDeposit, getDepositRejectionMessage, formatDepositSuccessMessage } =
    depositService();

  const result = await verifyAndApproveDeposit({
    userId: String(userId),
    rawProofText: text,
    paymentMethod: s.paymentMethod,
    /** Bot UI amount — stored for reference only; approval uses verifier API amount. */
    submittedAmount: Number(s.amount),
  });

  clearState(userId);

  if (!result.ok) {
    await ctx.reply(getDepositRejectionMessage(result.error));
    return;
  }

  await ctx.reply(formatDepositSuccessMessage(result));
}

async function handleDepositCommand(ctx) {
  await beginDeposit(ctx);
}

function isSlashCommandMessage(ctx) {
  return String(ctx.message?.text || '').trim().startsWith('/');
}

function registerDepositHandlers(bot) {
  bot.action('menu:deposit', (ctx) => startDeposit(ctx));
  bot.action('deposit:method:telebirr', (ctx) => chooseMethod(ctx, 'telebirr'));
  bot.action('deposit:method:cbe', (ctx) => chooseMethod(ctx, 'cbe'));

  bot.on(message('text'), async (ctx, next) => {
    if (isSlashCommandMessage(ctx)) {
      return next();
    }

    const withdrawHandled = await handleWithdrawText(ctx).catch(() => false);
    if (withdrawHandled) return;

    await handleAmountText(ctx).catch(() => {});
    await handleProofText(ctx).catch(() => {});
  });
}

module.exports = {
  registerDepositHandlers,
  clearDepositState: clearState,
  handleDepositCommand,
  startDeposit,
  beginDeposit,
};
