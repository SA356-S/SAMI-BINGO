const { Markup } = require('telegraf');
const {
  updateWithdrawStatus,
  formatWithdrawRequestNotification,
} = require('./withdrawAdminService');
const { editWithdrawBotMessage } = require('./telegramBotNotify');

function parseCallbackRequestId(match) {
  const id = String(match?.[1] || '').trim();
  return id || null;
}

async function handleWithdrawStatusAction(ctx, status) {
  const telegramId = ctx.from?.id;
  const requestId = parseCallbackRequestId(ctx.match);
  if (!requestId) {
    await ctx.answerCbQuery({ text: 'Invalid withdraw request.', show_alert: true }).catch(() => {});
    return;
  }

  const result = await updateWithdrawStatus(requestId, status, {
    actorTelegramId: telegramId,
  });

  if (!result.ok) {
    const message =
      result.error === 'not_authorized'
        ? 'You are not authorized to manage withdraw requests.'
        : result.error === 'already_processed'
          ? 'This request was already processed.'
          : result.message || result.error || 'Action failed.';
    await ctx.answerCbQuery({ text: message, show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCbQuery({ text: status === 'approved' ? 'Approved' : 'Rejected' }).catch(() => {});

  const request = result.request;
  const chatId = ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;

  if (chatId && messageId && request) {
    const updatedText = formatWithdrawRequestNotification(request);
    await editWithdrawBotMessage(chatId, messageId, updatedText, {
      inline_keyboard: [],
    });
  } else if (request) {
    await ctx.reply(formatWithdrawRequestNotification(request)).catch(() => {});
  }
}

function registerWithdrawAdminHandlers(bot) {
  bot.action(/^wd:approve:(.+)$/, (ctx) => handleWithdrawStatusAction(ctx, 'approved'));
  bot.action(/^wd:reject:(.+)$/, (ctx) => handleWithdrawStatusAction(ctx, 'rejected'));
}

function buildWithdrawActionKeyboard(requestId) {
  const id = String(requestId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `wd:approve:${id}`),
      Markup.button.callback('❌ Reject', `wd:reject:${id}`),
    ],
  ]).reply_markup;
}

module.exports = {
  registerWithdrawAdminHandlers,
  buildWithdrawActionKeyboard,
};
