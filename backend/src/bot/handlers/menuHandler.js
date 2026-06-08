const { WELCOME_MESSAGE, welcomeReply } = require('../keyboards');

const MENU_RESPONSES = {
  'menu:transfer': '🎁 Transfers are available inside the game after you tap Play.',
};

async function handleMenuAction(ctx, action) {
  await ctx.answerCbQuery();
  const text = MENU_RESPONSES[action];
  if (text) {
    await ctx.reply(text);
  }
}

function registerMenuHandlers(bot) {
  for (const action of Object.keys(MENU_RESPONSES)) {
    bot.action(action, (ctx) => handleMenuAction(ctx, action));
  }
}

/** /menu — same welcome as /start (single message + keyboard). */
async function handleMenuCommand(ctx) {
  await ctx.reply(WELCOME_MESSAGE, welcomeReply());
}

module.exports = { registerMenuHandlers, handleMenuCommand };
