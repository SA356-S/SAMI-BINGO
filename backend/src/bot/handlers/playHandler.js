const { PLAY_STAKE_MESSAGE, stakeSelectionReply } = require('../keyboards');

/**
 * Play — stake prompt + stake buttons (slash command and inline button).
 */
async function handlePlayCommand(ctx) {
  await ctx.reply(PLAY_STAKE_MESSAGE, stakeSelectionReply());
}

async function handlePlayMenu(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await handlePlayCommand(ctx);
}

function registerPlayHandlers(bot) {
  bot.action('menu:play', handlePlayMenu);
  bot.command('play', handlePlayCommand);
}

module.exports = { registerPlayHandlers, handlePlayMenu, handlePlayCommand };
