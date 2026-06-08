/** Lazy load — keeps bot startup light. */
function walletManager() {
  return require('../../socket/walletManager');
}

function formatBalanceMessage(mainWallet, playWallet) {
  const main = Math.max(0, Number(mainWallet) || 0);
  const play = Math.max(0, Number(playWallet) || 0);

  return [
    '💰 የሂሳብ መረጃ (Balance)',
    '',
    `🏆 Main Wallet: ${main} ETB`,
    `🎮 Play Wallet: ${play} ETB`,
  ].join('\n');
}

async function fetchUserBalances(telegramId) {
  if (!telegramId) {
    return { mainWallet: 0, playWallet: 0 };
  }

  const { getWalletBalanceAsync } = walletManager();
  const wallet = await getWalletBalanceAsync(String(telegramId));
  return {
    mainWallet: wallet.mainWallet ?? 0,
    playWallet: wallet.playWallet ?? 0,
  };
}

async function handleBalance(ctx) {
  await ctx.answerCbQuery().catch(() => {});

  const telegramId = ctx.from?.id;
  const { mainWallet, playWallet } = await fetchUserBalances(telegramId);
  await ctx.reply(formatBalanceMessage(mainWallet, playWallet));
}

async function handleBalanceCommand(ctx) {
  const telegramId = ctx.from?.id;
  const { mainWallet, playWallet } = await fetchUserBalances(telegramId);
  await ctx.reply(formatBalanceMessage(mainWallet, playWallet));
}

function registerBalanceHandlers(bot) {
  bot.action('menu:balance', handleBalance);
  bot.command('balance', handleBalanceCommand);
}

module.exports = {
  registerBalanceHandlers,
  handleBalance,
  handleBalanceCommand,
  formatBalanceMessage,
  fetchUserBalances,
};
