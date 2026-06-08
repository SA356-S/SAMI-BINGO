const { Telegraf } = require('telegraf');
const { loadEnv } = require('./config/env');
const { connectDatabase } = require('./config/db');
const { getTelegrafOptions, warmupTelegramConnection } = require('./config/telegramNetwork');

loadEnv();

let botInstance = null;

function createWithdrawBot() {
  const token = String(process.env.WITHDRAW_BOT_TOKEN || '').trim();
  if (!token) {
    return null;
  }

  const bot = new Telegraf(token, getTelegrafOptions());

  bot.catch((err) => {
    console.warn('[withdraw-bot] handler error:', err?.message || err);
  });

  const { registerWithdrawAdminHandlers } = require('./services/withdrawBotAdminHandlers');
  registerWithdrawAdminHandlers(bot);

  bot.start(async (ctx) => {
    const chatId = ctx.chat?.id;
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name || '';

    try {
      const { registerWithdrawNotifyChat } = require('./services/withdrawRequestNotifyService');
      await registerWithdrawNotifyChat({ chatId, telegramId, username });
    } catch (err) {
      console.warn('[withdraw-bot] register subscriber failed:', err?.message || err);
    }

    await ctx.reply(
      'Withdraw notification bot is active.\nYou will receive withdraw request alerts here.'
    );
  });

  return bot;
}

async function launchWithdrawBot() {
  if (botInstance) {
    return botInstance;
  }

  const bot = createWithdrawBot();
  if (!bot) {
    console.warn('[withdraw-bot] WITHDRAW_BOT_TOKEN is not set; withdraw bot will not start');
    return null;
  }

  try {
    await connectDatabase();
  } catch (err) {
    console.warn(
      '[withdraw-bot] MongoDB unavailable — starting without database:',
      err?.message || err
    );
  }

  try {
    bot.botInfo = await warmupTelegramConnection(process.env.WITHDRAW_BOT_TOKEN);
  } catch (err) {
    console.warn(
      '[withdraw-bot] Telegram warmup failed — launching anyway:',
      err?.message || err
    );
  }

  botInstance = bot;

  const stop = (signal) => {
    bot.stop(signal);
    console.log(`[withdraw-bot] stopped (${signal})`);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  const onRunning = () => {
    console.log('[withdraw-bot] Withdraw Telegram bot is running');
  };

  await bot.launch({ allowedUpdates: ['message', 'callback_query'] }, onRunning);
  return bot;
}

module.exports = { launchWithdrawBot, createWithdrawBot };

if (require.main === module) {
  launchWithdrawBot().catch((err) => {
    console.error('[withdraw-bot] failed to start:', err?.message || err);
    process.exit(1);
  });
}
