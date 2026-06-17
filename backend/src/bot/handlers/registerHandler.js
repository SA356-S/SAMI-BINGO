const {
  findByTelegramId,
  isRegistered,
  startRegistration,
  completeRegistration,
} = require('../../services/telegramUserService');
const {
  contactRequestKeyboard,
  removeKeyboardExtra,
  WELCOME_MESSAGE,
  welcomeReply,
} = require('../keyboards');

const REGISTER_PROMPT =
  '📱 ምዝገባዎን ለመጨረስ ፣ "📞 Share contact" የሚለውን ይጫኑ።';
const SUCCESS_MESSAGE = '🎉 ✅ Player registered successfully!';
const ALREADY_REGISTERED_MESSAGE = 'እርሶ አስቀድመው ተመዝግበዋል';
const OWN_CONTACT_ONLY_MESSAGE =
  '📱 እባክዎ የራስዎን ቁጥር ለመጋራት ከታች ያለውን "📞 Share contact" ቁልፍ ይጫኑ።';

function getTelegramProfile(ctx) {
  const from = ctx.from || {};
  return {
    telegramId: from.id,
    username: from.username || '',
    firstName: from.first_name || '',
    lastName: from.last_name || '',
  };
}

/** Register flow only — no play/stake messages mixed in. */
async function sendAlreadyRegistered(ctx) {
  await ctx.reply(ALREADY_REGISTERED_MESSAGE);
}

async function sendRegistrationPrompt(ctx) {
  await ctx.reply(REGISTER_PROMPT, contactRequestKeyboard());
}

async function beginRegistration(ctx) {
  const profile = getTelegramProfile(ctx);
  if (!profile.telegramId) {
    return;
  }

  const existing = await findByTelegramId(profile.telegramId);
  if (isRegistered(existing)) {
    return sendAlreadyRegistered(ctx);
  }

  await startRegistration(profile);
  return sendRegistrationPrompt(ctx);
}

async function handleContactShare(ctx) {
  const profile = getTelegramProfile(ctx);
  const contact = ctx.message?.contact;

  if (!profile.telegramId || !contact) {
    return;
  }

  const existing = await findByTelegramId(profile.telegramId);
  if (isRegistered(existing)) {
    await ctx.reply(ALREADY_REGISTERED_MESSAGE, removeKeyboardExtra());
    return;
  }

  if (contact.user_id !== profile.telegramId) {
    await ctx.reply(OWN_CONTACT_ONLY_MESSAGE, contactRequestKeyboard());
    return;
  }

  const phoneNumber = contact.phone_number || '';
  const result = await completeRegistration({
    telegramId: profile.telegramId,
    phoneNumber,
    firstName: contact.first_name || profile.firstName,
    lastName: profile.lastName,
    username: profile.username,
  });

  if (result.reason === 'already_registered') {
    await ctx.reply(ALREADY_REGISTERED_MESSAGE, removeKeyboardExtra());
    return;
  }

  if (!result.ok) {
    if (result.reason === 'not_pending') {
      await beginRegistration(ctx);
    }
    return;
  }

  await ctx.reply(SUCCESS_MESSAGE, removeKeyboardExtra());
  await ctx.reply(WELCOME_MESSAGE, welcomeReply());
}

function registerRegistrationHandlers(bot) {
  bot.command('register', async (ctx) => {
    await beginRegistration(ctx);
  });

  bot.action('menu:register', async (ctx) => {
    await ctx.answerCbQuery();
    await beginRegistration(ctx);
  });

  bot.on('contact', async (ctx) => {
    await handleContactShare(ctx);
  });
}

module.exports = {
  registerRegistrationHandlers,
  beginRegistration,
  REGISTER_PROMPT,
};
