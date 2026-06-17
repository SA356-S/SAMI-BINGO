const { findByTelegramId, isRegistered } = require('../services/telegramUserService');
const { contactRequestKeyboard } = require('./keyboards');
const { REGISTER_PROMPT } = require('./handlers/registerHandler');

function parseCommandName(text, botUsername) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;

  const token = trimmed.split(/\s+/)[0];
  const withoutSlash = token.slice(1);
  const atIndex = withoutSlash.indexOf('@');
  const name = (atIndex === -1 ? withoutSlash : withoutSlash.slice(0, atIndex)).toLowerCase();
  const target = atIndex === -1 ? null : withoutSlash.slice(atIndex + 1).toLowerCase();
  const me = botUsername ? String(botUsername).toLowerCase() : null;

  if (target && me && target !== me) return null;
  return name || null;
}

/** Updates allowed before registration is complete. */
function isRegistrationExempt(ctx) {
  if (ctx.message?.contact) return true;

  const callbackData = ctx.callbackQuery?.data;
  if (callbackData === 'menu:register') return true;

  const text = ctx.message?.text;
  if (!text) return false;

  const cmd = parseCommandName(text, ctx.me);
  return cmd === 'start' || cmd === 'register';
}

async function isUserRegistered(telegramId) {
  if (!telegramId) return false;
  const user = await findByTelegramId(telegramId);
  return isRegistered(user);
}

/**
 * Block bot menu/features for users who have not finished registration.
 * /start and /register still reach their handlers to drive onboarding.
 */
async function registrationGateMiddleware(ctx, next) {
  if (isRegistrationExempt(ctx)) {
    return next();
  }

  const registered = await isUserRegistered(ctx.from?.id);
  if (registered) {
    return next();
  }

  if (ctx.callbackQuery) {
    await ctx
      .answerCbQuery('📱 Please complete registration first.', { show_alert: true })
      .catch(() => {});
    return;
  }

  await ctx.reply(REGISTER_PROMPT, contactRequestKeyboard()).catch(() => {});
}

module.exports = {
  registrationGateMiddleware,
  isRegistrationExempt,
  isUserRegistered,
};
