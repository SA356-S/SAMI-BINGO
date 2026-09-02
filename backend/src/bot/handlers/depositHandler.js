const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const { handleWithdrawText } = require('./withdrawHandler');
const { message } = require('telegraf/filters');
const {
  getRotatedTelebirrAccount,
  findTelebirrAccount,
  getPublicDepositMethods,
} = require('../../config/depositAccounts');
const {
  verifyAndCreditDeposit,
  getDepositRejectionMessage,
  formatDepositSuccessMessage,
  extractTelebirrReference,
  extractCbeReference,
} = require('../../services/depositVerificationService');
const { SUPPORT_CONTACTS } = require('./supportHandler');

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
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔴 Telebirr', 'deposit:method:telebirr'),
      Markup.button.callback('🔴 CBEBirr', 'deposit:method:cbe'),
    ],
  ]);
}

function supportHandle() {
  return SUPPORT_CONTACTS[0]?.label || '@Edil_bingo';
}

function formatDepositChooser() {
  return [
    '<b>💳 Deposit / Top-Up</b>',
    '',
    'Please choose your preferred payment method below:',
  ].join('\n');
}

function formatTelebirrInstructions(account) {
  const number = account.displayNumber || account.number;
  return [
    '<b>🏦 Telebirr Deposit</b>',
    `<b>Account:</b> <code>${number}</code>`,
    '',
    '<b>📱 Telebirr Deposit Steps</b>',
    '1️⃣ ከላይ ባለው የ Telebirr አካውንት ገንዘቡን ያስገቡ።',
    '2️⃣ ክፍያ ካደረጉ በኋላ የ Telebirr የጽሁፍ መልእክት (SMS) ይደርስዎታል፡፡',
    '3️⃣ የደረሳችሁን SMS ሙሉ በሙሉ ኮፒ በማድረግ በዚህ ቻት ፔስት አድርጉ፡፡',
    '',
    `💬 የክፍያ ችግር ካለ፣ ${supportHandle()} ይጠቀሙ፡፡`,
    '',
    '------------------------------',
    '📩 After sending payment, please paste the SMS confirmation below 👇',
    'You can paste multiple times if needed.',
  ].join('\n');
}

function cbeDisplayAccount(cbe) {
  return cbe?.number || cbe?.account || '';
}

function formatCbeInstructions(cbe) {
  const accountValue = cbeDisplayAccount(cbe);
  const lines = [
    '<b>🏦 CBEBirr Deposit</b>',
    `<b>Account:</b> <code>${accountValue}</code>`,
  ];
  if (cbe?.receiverName) {
    lines.push(`<b>Name:</b> ${cbe.receiverName}`);
  }
  lines.push(
    '',
    '<b>📱 CBEBirr Deposit Steps</b>',
    '1️⃣ ከላይ ባለው የ CBEBirr አካውንት ገንዘቡን ያስገቡ።',
    '2️⃣ ክፍያ ካደረጉ በኋላ የ CBEBirr የጽሁፍ መልእክት (SMS) ይደርስዎታል፡፡',
    '3️⃣ የደረሳችሁን SMS ሙሉ በሙሉ ኮፒ በማድረግ በዚህ ቻት ፔስት አድርጉ፡፡',
    '',
    `💬 የክፍያ ችግር ካለ፣ ${supportHandle()} ይጠቀሙ፡፡`,
    '',
    '------------------------------',
    '📩 After sending payment, please paste the SMS confirmation below 👇',
    'You can paste multiple times if needed.'
  );
  return lines.join('\n');
}

function instructionPhotoPath(provider) {
  const names =
    provider === 'cbe'
      ? ['deposit-cbebirr.jpg', 'deposit-cbebirr.png', 'deposit-cbe.jpg', 'deposit-cbe.png']
      : ['deposit-telebirr.jpg', 'deposit-telebirr.png'];
  const dirs = [
    path.join(__dirname, '../assets'),
    path.join(__dirname, '../../../public/uploads'),
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

async function sendInstructions(ctx, provider, caption) {
  const photo = instructionPhotoPath(provider);
  if (photo) {
    await ctx.replyWithPhoto(
      { source: photo },
      { caption, parse_mode: 'HTML' }
    );
    return;
  }
  await ctx.reply(caption, { parse_mode: 'HTML' });
}

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
  setState(userId, { step: 'await_method', amount: null, provider: null, receivingNumber: null });
  await ctx.reply(formatDepositChooser(), {
    parse_mode: 'HTML',
    ...getMethodKeyboard(),
  });
}

async function startDeposit(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await beginDeposit(ctx);
}

async function handleAmountText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_amount' || !s.provider) return false;

  const n = Number(String(ctx.message?.text || '').trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) {
    await ctx.reply('እባክዎ ትክክለኛ መጠን ያስገቡ (ለምሳሌ 50)።');
    return true;
  }

  setState(userId, {
    ...s,
    step: 'await_reference',
    amount: n,
  });
  await ctx.reply(
    `መጠን: ${n} ETB\n\nክፍያውን ከፈጸሙ በኋላ የግብይት / Transaction ቁጥር ያስገቡ።`
  );
  return true;
}

async function chooseMethod(ctx, methodKey) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const s = getState(userId);
  if (!s || s.step !== 'await_method') {
    clearState(userId);
    await ctx.reply('እንደገና ለመጀመር Deposit ቁልፍን ይንኩ።');
    return;
  }

  await ctx.answerCbQuery().catch(() => {});
  const methods = getPublicDepositMethods();

  if (methodKey === 'telebirr') {
    if (!methods.telebirr.enabled) {
      await ctx.reply('Telebirr ተቀማጭ አሁን አልተዋቀረም።');
      return;
    }
    const account = getRotatedTelebirrAccount();
    if (!account) {
      await ctx.reply('Telebirr ተቀማጭ አሁን አልተዋቀረም።');
      return;
    }
    setState(userId, {
      step: 'await_receipt',
      amount: null,
      provider: 'telebirr',
      receivingNumber: account.displayNumber || account.number,
    });
    await sendInstructions(ctx, 'telebirr', formatTelebirrInstructions(account));
    return;
  }

  if (!methods.cbe.enabled) {
    await ctx.reply('CBE Birr ተቀማጭ አሁን አልተዋቀረም።');
    return;
  }

  setState(userId, {
    step: 'await_receipt',
    amount: null,
    provider: 'cbe',
    receivingNumber: cbeDisplayAccount(methods.cbe),
  });
  await sendInstructions(ctx, 'cbe', formatCbeInstructions(methods.cbe));
}

async function chooseTelebirrNumber(ctx, numberKey) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const s = getState(userId);
  if (!s || (s.step !== 'await_telebirr_number' && s.step !== 'await_method')) {
    clearState(userId);
    await ctx.reply('እንደገና ለመጀመር Deposit ቁልፍን ይንኩ።');
    return;
  }

  await ctx.answerCbQuery().catch(() => {});
  const account = findTelebirrAccount(numberKey);
  if (!account) {
    await ctx.reply('ይህ የTelebirr ቁጥር አልተዋቀረም።');
    return;
  }

  setState(userId, {
    step: 'await_receipt',
    amount: null,
    provider: 'telebirr',
    receivingNumber: account.displayNumber || account.number,
  });
  await sendInstructions(ctx, 'telebirr', formatTelebirrInstructions(account));
}

async function handleReceiptText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_receipt') return false;
  if (s.provider !== 'telebirr' && s.provider !== 'cbe') return false;

  const raw = String(ctx.message?.text || '').trim();
  const reference =
    s.provider === 'cbe' ? extractCbeReference(raw) : extractTelebirrReference(raw);
  if (!reference || reference.length < 4) {
    await ctx.reply(
      s.provider === 'cbe'
        ? 'እባክዎ የCBE Birr SMS / receipt መልእክት ሙሉ በሙሉ ይለጥፉ።'
        : 'እባክዎ የTelebirr SMS / receipt መልእክት ሙሉ በሙሉ ይለጥፉ።'
    );
    return true;
  }

  await ctx.reply('⏳ ክፍያ በማረጋገጥ ላይ…');

  const result = await verifyAndCreditDeposit({
    userId: String(userId),
    provider: s.provider,
    reference: raw,
    receivingNumber: s.receivingNumber,
    source: 'bot',
  });

  if (!result.ok && result.error === 'invalid_amount') {
    await ctx.reply(
      s.provider === 'cbe'
        ? 'እባክዎ መጠኑ የሚታይበትን ሙሉ የCBE Birr SMS ይለጥፉ።'
        : 'እባክዎ መጠኑ የሚታይበትን ሙሉ የTelebirr SMS ይለጥፉ።'
    );
    return true;
  }

  clearState(userId);

  if (!result.ok) {
    await ctx.reply(getDepositRejectionMessage(result.error));
    return true;
  }

  await ctx.reply(formatDepositSuccessMessage(result));
  return true;
}

async function handleReferenceText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_reference') return false;

  const reference = String(ctx.message?.text || '').trim();
  if (!reference || reference.length < 4) {
    await ctx.reply('እባክዎ የግብይት / Transaction ቁጥር ያስገቡ።');
    return true;
  }

  await ctx.reply('⏳ ክፍያ በማረጋገጥ ላይ…');

  const result = await verifyAndCreditDeposit({
    userId: String(userId),
    provider: s.provider,
    reference,
    amount: Number(s.amount),
    receivingNumber: s.receivingNumber,
    source: 'bot',
  });

  clearState(userId);

  if (!result.ok) {
    await ctx.reply(getDepositRejectionMessage(result.error));
    return true;
  }

  await ctx.reply(formatDepositSuccessMessage(result));
  return true;
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
  bot.action(/^deposit:telebirr:(.+)$/, (ctx) =>
    chooseTelebirrNumber(ctx, ctx.match[1])
  );

  bot.on(message('text'), async (ctx, next) => {
    if (isSlashCommandMessage(ctx)) {
      return next();
    }

    const withdrawHandled = await handleWithdrawText(ctx).catch(() => false);
    if (withdrawHandled) return;

    const amountHandled = await handleAmountText(ctx).catch(() => false);
    if (amountHandled) return;

    const receiptHandled = await handleReceiptText(ctx).catch(() => false);
    if (receiptHandled) return;

    await handleReferenceText(ctx).catch(() => {});
  });
}

module.exports = {
  registerDepositHandlers,
  clearDepositState: clearState,
  handleDepositCommand,
  startDeposit,
  beginDeposit,
  verifyAndCreditDeposit,
  getRotatedTelebirrAccount,
  formatCbeInstructions,
  formatDepositChooser,
  cbeDisplayAccount,
};
