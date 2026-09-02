const { Markup } = require('telegraf');
const {
  getInvitePayload,
  buildReferralLink,
  getOrCreateReferralCode,
  getReferralStats,
} = require('../../services/referralService');

const INVITE_HEADER = '🔗 Invite your friends to Capital Bingo and earn rewards!';

function formatInviteMessage(referralLink, totalInvited) {
  const lines = [INVITE_HEADER, '', `🎁 ${referralLink}`];
  if (Number(totalInvited) > 0) {
    lines.push('', `👥 Friends invited: ${totalInvited}`);
  }
  return lines.join('\n');
}

function buildShareUrl(referralLink) {
  const text = encodeURIComponent('🔗 Join Capital Bingo and play with me!');
  const url = encodeURIComponent(referralLink);
  return `https://t.me/share/url?url=${url}&text=${text}`;
}

function inviteReplyKeyboard(referralLink) {
  return Markup.inlineKeyboard([
    [Markup.button.url('📤 Share Link', buildShareUrl(referralLink))],
    [Markup.button.callback('📋 Copy Link', 'invite:copy')],
  ]);
}

async function sendInviteMessage(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const { referralLink, totalInvited } = await getInvitePayload(String(userId));
  await ctx.reply(formatInviteMessage(referralLink, totalInvited), {
    ...inviteReplyKeyboard(referralLink),
    disable_web_page_preview: true,
  });
}

async function handleInviteAction(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await sendInviteMessage(ctx);
}

async function handleInviteCommand(ctx) {
  await sendInviteMessage(ctx);
}

async function handleCopyLink(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.answerCbQuery().catch(() => {});
  const code = await getOrCreateReferralCode(String(userId));
  const link = buildReferralLink(code);
  await ctx.reply(`📋 Tap and hold to copy:\n\n${link}`, {
    disable_web_page_preview: true,
  });
}

function registerInviteHandlers(bot) {
  bot.action('menu:invite', handleInviteAction);
  bot.action('invite:copy', handleCopyLink);
  bot.command('invite', handleInviteCommand);
}

module.exports = {
  registerInviteHandlers,
  sendInviteMessage,
  handleInviteCommand,
  formatInviteMessage,
  inviteReplyKeyboard,
};
