const { Telegraf } = require('telegraf');
const { loadEnv } = require('./config/env');
const { connectDatabase } = require('./config/db');
const { getTelegrafOptions, warmupTelegramConnection } = require('./config/telegramNetwork');
const {
  registerCommandHandlers,
  setupBotCommands,
} = require('./bot/handlers/commandHandler');
const { registerRegistrationHandlers } = require('./bot/handlers/registerHandler');
const { registerPlayHandlers } = require('./bot/handlers/playHandler');
const { registerMenuHandlers } = require('./bot/handlers/menuHandler');
const { registerBalanceHandlers } = require('./bot/handlers/balanceHandler');
const { registerDepositHandlers } = require('./bot/handlers/depositHandler');
const { registerManualDepositHandlers } = require('./bot/handlers/manualDepositHandler');
const { registerWithdrawHandlers } = require('./bot/handlers/withdrawHandler');
const { registerInviteHandlers } = require('./bot/handlers/inviteHandler');
const { registerInstructionHandlers } = require('./bot/handlers/instructionHandler');
const { registerSupportHandlers } = require('./bot/handlers/supportHandler');
const { getMiniAppUrl, validateMiniAppUrl } = require('./config/miniAppUrl');
const { syncTelegramProfileFromClient } = require('./services/telegramUserService');
const { registrationGateMiddleware } = require('./bot/registrationGate');

loadEnv();
require('./config/paymentMethods').getPaymentMethods();

let botInstance = null;
const profileSyncLastAt = new Map();
const PROFILE_SYNC_MIN_MS = Math.max(
  30_000,
  Number(process.env.BOT_PROFILE_SYNC_MIN_MS) || 60_000
);
const PROFILE_SYNC_MAP_MAX = 10_000;

function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    return null;
  }

  const bot = new Telegraf(token, getTelegrafOptions());

  bot.catch((err) => {
    console.warn('[bot] handler error:', err?.message || err);
  });

  bot.use((ctx, next) => {
    const from = ctx.from;
    if (from?.id) {
      const key = String(from.id);
      const now = Date.now();
      const last = profileSyncLastAt.get(key) || 0;
      if (now - last >= PROFILE_SYNC_MIN_MS) {
        profileSyncLastAt.set(key, now);
        if (profileSyncLastAt.size > PROFILE_SYNC_MAP_MAX) {
          const oldest = profileSyncLastAt.keys().next().value;
          if (oldest != null) profileSyncLastAt.delete(oldest);
        }
        void syncTelegramProfileFromClient({
          telegramId: from.id,
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
        }).catch((err) => {
          console.warn('[bot] user sync failed', from.id, err?.message);
        });
      }
    }
    return next();
  });

  bot.use(registrationGateMiddleware);

  /** Commands (/start, /help, etc.) — message updates only. */
  registerCommandHandlers(bot);

  /** Inline keyboard callbacks — callback_query updates only. */
  registerPlayHandlers(bot);
  registerMenuHandlers(bot);
  registerBalanceHandlers(bot);
  registerRegistrationHandlers(bot);
  registerManualDepositHandlers(bot);
  registerDepositHandlers(bot);
  registerWithdrawHandlers(bot);
  registerInviteHandlers(bot);
  registerInstructionHandlers(bot);
  registerSupportHandlers(bot);

  return bot;
}

async function launchBot() {
  if (botInstance) {
    return botInstance;
  }

  const bot = createBot();
  if (!bot) {
    console.warn('[bot] BOT_TOKEN is not set; Telegram bot will not start');
    return null;
  }

  try {
    await connectDatabase();
  } catch (err) {
    console.error(
      '[bot] MongoDB unavailable — starting Telegram bot without database:',
      err?.message || err
    );
    console.warn(
      '[bot] Registration, deposits, and user sync will fail until MongoDB reconnects.'
    );
  }

  validateMiniAppUrl();

  try {
    bot.botInfo = await warmupTelegramConnection(process.env.BOT_TOKEN);
  } catch (err) {
    console.warn(
      '[bot] Telegram warmup failed — launching anyway:',
      err?.message || err
    );
  }

  botInstance = bot;

  const stop = (signal) => {
    bot.stop(signal);
    console.log(`[bot] stopped (${signal})`);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  const onRunning = () => {
    console.log('[bot] Telegram bot is running');
    console.log(`[bot] Mini App URL: ${getMiniAppUrl()}`);
  };

  await setupBotCommands(bot);

  const launchOptions = {
    allowedUpdates: ['message', 'edited_message', 'callback_query'],
  };

  try {
    await bot.launch(launchOptions, onRunning);
  } catch (err) {
    console.warn('[bot] Launch failed, one retry:', err?.message || err);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await bot.launch(launchOptions, onRunning);
  }
  return bot;
}

module.exports = { launchBot, createBot };

if (require.main === module) {
  launchBot().catch((err) => {
    console.error('[bot] failed to start:', err?.message || err);
    process.exit(1);
  });
}
