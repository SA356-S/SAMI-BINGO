const { Markup } = require('telegraf');
const {
  MSG_NO_BALANCE,
  MSG_MIN_REMAINING,
  getMainWalletBalance,
  validateWithdrawAmount,
  submitWithdrawRequest,
} = require('../../services/botWithdrawService');

const WITHDRAW_STATE_TTL_MS = 30 * 60 * 1000;
const withdrawState = new Map();

const PROMPT_AMOUNT = '💰 ማውጣት የሚፈልጉትን የገንዘብ መጠን ያስገቡ ?';
const PROMPT_METHOD = '💸 የሚፈልጉትን የክፍያ አማራጭ ይምረጡ፡';
const PROMPT_PHONE = '👤 እባክዎ የስልክ ቁጥርዎን ያስገቡ፡፡';
const PROMPT_NAME = '👤 እባክዎ የአካውንቱን ባለቤት ስም ያስገቡ፡፡';
const PROMPT_INVALID_AMOUNT = 'እባክዎ ትክክለኛ የገንዘብ መጠን ያስገቡ።';
const PROMPT_CANCELLED = '❌ Withdrawal cancelled.';

function now() {
  return Date.now();
}

function getState(userId) {
  const key = String(userId);
  const s = withdrawState.get(key);
  if (!s) return null;
  if (now() - s.createdAt > WITHDRAW_STATE_TTL_MS) {
    withdrawState.delete(key);
    return null;
  }
  return s;
}

function setState(userId, next) {
  withdrawState.set(String(userId), { ...next, createdAt: now() });
}

function clearWithdrawState(userId) {
  if (userId != null) withdrawState.delete(String(userId));
}

function pruneExpiredStates() {
  const t = now();
  for (const [k, v] of withdrawState.entries()) {
    if (t - v.createdAt > WITHDRAW_STATE_TTL_MS) withdrawState.delete(k);
  }
}

function clearOtherFlowState(userId) {
  try {
    const { clearDepositState } = require('./depositHandler');
    clearDepositState(userId);
  } catch {
    /* optional */
  }
}

function getWithdrawMethodKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Telebirr', 'withdraw:method:telebirr')],
    [Markup.button.callback('CBE Birr', 'withdraw:method:cbe')],
    [Markup.button.callback('❌ Cancel', 'withdraw:cancel')],
  ]);
}

function formatSuccessMessage(amount) {
  return `✅ የ${amount} ብር የወጪ ጥያቄዎ ወደ አድሚኖች ተልኳል። እባክዎ ትንሽ ይጠብቁ፡፡`;
}

function normalizePhone(text) {
  return String(text || '').trim().replace(/\s+/g, '');
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 13;
}

/** Shared withdraw entry — inline button and /withdraw command. */
async function beginWithdraw(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  pruneExpiredStates();
  clearOtherFlowState(userId);
  clearWithdrawState(userId);

  const mainBalance = await getMainWalletBalance(userId);
  if (mainBalance <= 0) {
    await ctx.reply(MSG_NO_BALANCE);
    return;
  }

  setState(userId, {
    step: 'await_amount',
    amount: null,
    paymentMethod: null,
    phone: null,
    mainBalanceSnapshot: mainBalance,
  });
  await ctx.reply(PROMPT_AMOUNT);
}

async function startWithdraw(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await beginWithdraw(ctx);
}

async function handleWithdrawCommand(ctx) {
  await beginWithdraw(ctx);
}

async function handleAmountText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  if (String(ctx.message?.text || '').trim().startsWith('/')) {
    return false;
  }

  const s = getState(userId);
  if (!s || s.step !== 'await_amount') return false;

  const mainBalance = await getMainWalletBalance(userId);
  const validation = validateWithdrawAmount(
    mainBalance,
    ctx.message?.text || ''
  );

  if (!validation.ok) {
    if (validation.error === 'invalid_amount') {
      await ctx.reply(PROMPT_INVALID_AMOUNT);
      return true;
    }
    if (validation.message) {
      await ctx.reply(validation.message);
    }
    if (validation.error === 'no_balance') {
      clearWithdrawState(userId);
    }
    return true;
  }

  setState(userId, {
    step: 'await_method',
    amount: validation.amount,
    paymentMethod: null,
    phone: null,
    mainBalanceSnapshot: mainBalance,
  });
  await ctx.reply(PROMPT_METHOD, getWithdrawMethodKeyboard());
  return true;
}

async function chooseMethod(ctx, methodKey) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const s = getState(userId);
  if (!s || s.step !== 'await_method' || !s.amount) {
    clearWithdrawState(userId);
    await ctx.reply('Tap Withdraw to start again.');
    return;
  }

  await ctx.answerCbQuery().catch(() => {});
  setState(userId, {
    step: 'await_phone',
    amount: s.amount,
    paymentMethod: methodKey,
    phone: null,
    mainBalanceSnapshot: s.mainBalanceSnapshot,
  });
  await ctx.reply(PROMPT_PHONE);
}

async function cancelWithdraw(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.answerCbQuery().catch(() => {});
  clearWithdrawState(userId);
  await ctx.reply(PROMPT_CANCELLED);
}

async function handlePhoneText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_phone') return false;

  const phone = normalizePhone(ctx.message?.text);
  if (!isValidPhone(phone)) {
    await ctx.reply(PROMPT_PHONE);
    return true;
  }

  setState(userId, {
    ...s,
    step: 'await_name',
    phone,
  });
  await ctx.reply(PROMPT_NAME);
  return true;
}

async function handleNameText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_name') return false;

  const accountName = String(ctx.message?.text || '').trim();
  if (accountName.length < 2) {
    await ctx.reply(PROMPT_NAME);
    return true;
  }

  const from = ctx.from || {};
  const result = await submitWithdrawRequest({
    userId: String(userId),
    amount: s.amount,
    paymentMethod: s.paymentMethod,
    phone: s.phone,
    accountName,
    telegramUsername: from.username || '',
    telegramFirstName: from.first_name || '',
  });

  clearWithdrawState(userId);

  if (!result.ok) {
    await ctx.reply(result.message || MSG_MIN_REMAINING);
    return true;
  }

  await ctx.reply(formatSuccessMessage(result.amount));
  return true;
}

async function handleWithdrawText(ctx) {
  if (await handleAmountText(ctx)) return true;
  if (await handlePhoneText(ctx)) return true;
  if (await handleNameText(ctx)) return true;
  return false;
}

function registerWithdrawHandlers(bot) {
  bot.action('menu:withdraw', startWithdraw);
  bot.action('withdraw:method:telebirr', (ctx) => chooseMethod(ctx, 'telebirr'));
  bot.action('withdraw:method:cbe', (ctx) => chooseMethod(ctx, 'cbe'));
  bot.action('withdraw:cancel', cancelWithdraw);
}

module.exports = {
  registerWithdrawHandlers,
  startWithdraw,
  beginWithdraw,
  handleWithdrawCommand,
  handleWithdrawText,
  clearWithdrawState,
};
