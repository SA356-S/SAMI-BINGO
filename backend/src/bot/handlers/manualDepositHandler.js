const { message } = require('telegraf/filters');
const {
  getPublicDepositMethods,
  getRotatedTelebirrAccount,
} = require('../../config/depositAccounts');
const {
  submitManualDeposit,
  parseAmountFromText,
} = require('../../services/manualDepositService');
const { SUPPORT_CONTACTS } = require('./supportHandler');

const MANUAL_STATE_TTL_MS = 30 * 60 * 1000;
const manualState = new Map();

function now() {
  return Date.now();
}

function getState(userId) {
  const key = String(userId);
  const s = manualState.get(key);
  if (!s) return null;
  if (now() - s.createdAt > MANUAL_STATE_TTL_MS) {
    manualState.delete(key);
    return null;
  }
  return s;
}

function setState(userId, next) {
  manualState.set(String(userId), { ...next, createdAt: now() });
}

function clearManualDepositState(userId) {
  if (userId != null) manualState.delete(String(userId));
}

function pruneExpiredStates() {
  const t = now();
  for (const [k, v] of manualState.entries()) {
    if (t - v.createdAt > MANUAL_STATE_TTL_MS) manualState.delete(k);
  }
}

function supportHandle() {
  return SUPPORT_CONTACTS[0]?.label || '@Edil_bingo';
}

function formatManualDepositInstructions() {
  const methods = getPublicDepositMethods();
  const telebirr = getRotatedTelebirrAccount();
  const lines = [
    '<b>💳 Manual Deposit</b>',
    '',
    'Please pay to one of the accounts below, then send a screenshot of your payment receipt.',
    '',
  ];

  if (telebirr) {
    const number = telebirr.displayNumber || telebirr.number;
    lines.push(
      '<b>🏦 Telebirr</b>',
      `<b>Account:</b> <code>${number}</code>`
    );
    if (telebirr.receiverName) {
      lines.push(`<b>Name:</b> ${telebirr.receiverName}`);
    }
    lines.push('');
  } else if (methods.telebirr?.enabled && methods.telebirr.accounts?.[0]) {
    const account = methods.telebirr.accounts[0];
    lines.push(
      '<b>🏦 Telebirr</b>',
      `<b>Account:</b> <code>${account.number}</code>`
    );
    if (account.receiverName) {
      lines.push(`<b>Name:</b> ${account.receiverName}`);
    }
    lines.push('');
  }

  if (methods.cbe?.enabled) {
    const accountValue = methods.cbe.number || methods.cbe.account || '';
    lines.push('<b>🏦 CBEBirr</b>');
    if (accountValue) {
      lines.push(`<b>Account:</b> <code>${accountValue}</code>`);
    }
    if (methods.cbe.receiverName) {
      lines.push(`<b>Name:</b> ${methods.cbe.receiverName}`);
    }
    lines.push('');
  }

  lines.push(
    '<b>📱 Manual Deposit Steps</b>',
    '1️⃣ ከላይ ባለው አካውንት ገንዘቡን ያስገቡ።',
    '2️⃣ ክፍያ ካደረጉ በኋላ የክፍያ ስክሪንሾት / ፎቶ ይላኩ።',
    '3️⃣ መጠኑን መጻፍ ይችላሉ (አማራጭ)፣ ከዚያ ፎቶውን ይላኩ።',
    '',
    'Wallet አውቶማቲክ አይሞላም — admin እስኪያረጋግጥ ይጠብቁ።',
    '',
    `💬 የክፍያ ችግር ካለ፣ ${supportHandle()} ይጠቀሙ፡፡`,
    '',
    '------------------------------',
    '📩 After payment, send a screenshot of the receipt here 👇'
  );

  return lines.join('\n');
}

function largestPhoto(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return photos.reduce((best, item) => {
    const area = (Number(item?.width) || 0) * (Number(item?.height) || 0);
    const bestArea = (Number(best?.width) || 0) * (Number(best?.height) || 0);
    return area >= bestArea ? item : best;
  }, photos[0]);
}

function photoFromMessage(msg) {
  const photo = largestPhoto(msg?.photo);
  if (photo?.file_id) {
    return {
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id || '',
      width: photo.width || null,
      height: photo.height || null,
      caption: String(msg.caption || ''),
    };
  }

  const doc = msg?.document;
  const mime = String(doc?.mime_type || '');
  if (doc?.file_id && mime.startsWith('image/')) {
    return {
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id || '',
      width: null,
      height: null,
      caption: String(msg.caption || ''),
    };
  }

  return null;
}

function clearOtherFlows(userId) {
  try {
    require('./depositHandler').clearDepositState(userId);
  } catch {
    /* optional */
  }
  try {
    require('./withdrawHandler').clearWithdrawState(userId);
  } catch {
    /* optional */
  }
}

async function beginManualDeposit(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  pruneExpiredStates();
  clearOtherFlows(userId);
  setState(userId, { step: 'await_photo', submittedAmount: null });

  await ctx.reply(formatManualDepositInstructions(), {
    parse_mode: 'HTML',
  });
}

async function handleManualDepositCommand(ctx) {
  await beginManualDeposit(ctx);
}

async function handleManualDepositText(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_photo') return false;

  const text = String(ctx.message?.text || '').trim();
  if (text.startsWith('/')) return false;

  const amount = parseAmountFromText(text);
  if (amount == null) {
    await ctx.reply(
      'እባክዎ የክፍያ ስክሪንሾት / ፎቶ ይላኩ። መጠን መጻፍ ከፈለጉ ቁጥር ብቻ ይጻፉ (ለምሳሌ 100)።'
    );
    return true;
  }

  setState(userId, { ...s, submittedAmount: amount });
  await ctx.reply(
    `መጠን: ${amount} ETB\n\nአሁን የክፍያ ስክሪንሾት / ፎቶ ይላኩ።`
  );
  return true;
}

async function handleManualDepositPhoto(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const s = getState(userId);
  if (!s || s.step !== 'await_photo') return false;

  const photo = photoFromMessage(ctx.message);
  if (!photo) return false;

  const captionAmount = parseAmountFromText(photo.caption);
  const submittedAmount = captionAmount ?? s.submittedAmount ?? null;

  const result = await submitManualDeposit({
    userId: String(userId),
    telegramUsername: ctx.from?.username || '',
    telegramFirstName: ctx.from?.first_name || '',
    telegramLastName: ctx.from?.last_name || '',
    submittedAmount,
    photoFileId: photo.fileId,
    photoFileUniqueId: photo.fileUniqueId,
    photoWidth: photo.width,
    photoHeight: photo.height,
    photoCaption: photo.caption,
  });

  if (!result.ok && result.error === 'already_pending') {
    await ctx.reply(
      '⏳ አስቀድመው pending Manual Deposit አለዎት። Admin እስኪያረጋግጥ ይጠብቁ።'
    );
    return true;
  }

  if (!result.ok) {
    await ctx.reply(
      result.error === 'database_unavailable'
        ? '❌ Database ሊደርስ አልተቻለም። ትንሽ ቆይተው ይሞክሩ።'
        : '❌ ስክሪንሾቱን ማስቀመጥ አልተሳካም። እንደገና ይሞክሩ።'
    );
    return true;
  }

  clearManualDepositState(userId);

  const amountLine =
    submittedAmount != null ? `መጠን: ${submittedAmount} ETB` : 'መጠን: — (admin ያረጋግጣል)';

  await ctx.reply(
    [
      '📩 የክፍያ ስክሪንሾትዎ ደርሷል።',
      '',
      amountLine,
      'Status: pending',
      '',
      'Admin እስኪያረጋግጥ ይጠብቁ። Wallet አሁን አይሞላም።',
      '',
      'Your payment is waiting for admin verification.',
    ].join('\n')
  );
  return true;
}

function isSlashCommandMessage(ctx) {
  return String(ctx.message?.text || '').trim().startsWith('/');
}

function registerManualDepositHandlers(bot) {
  bot.command('manualdeposit', handleManualDepositCommand);

  bot.on(message('text'), async (ctx, next) => {
    if (isSlashCommandMessage(ctx)) {
      return next();
    }
    const handled = await handleManualDepositText(ctx).catch(() => false);
    if (handled) return;
    return next();
  });

  bot.on(message('photo'), async (ctx, next) => {
    const handled = await handleManualDepositPhoto(ctx).catch(() => false);
    if (handled) return;
    return next();
  });

  bot.on(message('document'), async (ctx, next) => {
    const handled = await handleManualDepositPhoto(ctx).catch(() => false);
    if (handled) return;
    return next();
  });
}

module.exports = {
  registerManualDepositHandlers,
  handleManualDepositCommand,
  handleManualDepositText,
  handleManualDepositPhoto,
  formatManualDepositInstructions,
  clearManualDepositState,
  photoFromMessage,
  parseAmountFromText,
};
