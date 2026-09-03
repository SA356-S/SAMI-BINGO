const { WELCOME_MESSAGE, welcomeReply } = require('../keyboards');
const { handleBalanceCommand } = require('./balanceHandler');
const { handlePlayCommand } = require('./playHandler');
const { handleDepositCommand } = require('./depositHandler');
const { handleWithdrawCommand } = require('./withdrawHandler');
const { processStartReferral } = require('../../services/referralService');
const { findByTelegramId, isRegistered } = require('../../services/telegramUserService');
const { beginRegistration } = require('./registerHandler');

const HELP_MESSAGE = [
  '📖 Capital Bingo Bot Help',
  '',
  '/start — Open the bot',
  '/register — Register your phone number',
  '/balance — Main & play wallet balances',
  '/withdraw — Withdraw from main wallet',
  '/manualdeposit — Manual deposit (screenshot)',
  '/invite — Invite friends & earn rewards',
  '/instruction — Bingo game instructions',
  '/support — Contact support',
  '/help — This message',
  '',
  'After /start, use the inline buttons for Play, Deposit, Balance, and more.',
].join('\n');

const BOT_COMMANDS = [
  { command: 'start', description: 'Start' },
  { command: 'register', description: 'Register' },
  { command: 'play', description: 'Play' },
  { command: 'deposit', description: 'Deposit' },
  { command: 'balance', description: 'Balance' },
  { command: 'withdraw', description: 'Withdraw' },
  { command: 'manualdeposit', description: 'Manual Deposit' },
  { command: 'invite', description: 'Invite friends' },
  { command: 'instruction', description: 'Instruction' },
  { command: 'support', description: 'Support' },
];

async function handleStartCommand(ctx) {
  await processStartReferral(ctx).catch(() => {});

  const user = await findByTelegramId(ctx.from?.id);
  if (isRegistered(user)) {
    await ctx.reply(WELCOME_MESSAGE, welcomeReply());
    return;
  }

  await beginRegistration(ctx);
}

async function handleHelpCommand(ctx) {
  await ctx.reply(HELP_MESSAGE, welcomeReply());
}

/**
 * Fallback for /commands when Telegram omits bot_command entities
 * (telegraf command middleware runs first; this only catches what it missed).
 */
function parseMessageCommand(text, botUsername) {
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

async function handleFallbackCommand(ctx) {
  const cmd = parseMessageCommand(ctx.message?.text, ctx.me);
  if (!cmd) return false;

  switch (cmd) {
    case 'start':
      await handleStartCommand(ctx);
      return true;
    case 'help':
      await handleHelpCommand(ctx);
      return true;
    case 'play':
      await handlePlayCommand(ctx);
      return true;
    case 'deposit':
      await handleDepositCommand(ctx);
      return true;
    case 'balance':
      await handleBalanceCommand(ctx);
      return true;
    case 'withdraw':
      await handleWithdrawCommand(ctx);
      return true;
    case 'manualdeposit':
      await require('./manualDepositHandler').handleManualDepositCommand(ctx);
      return true;
    case 'invite':
      await require('./inviteHandler').handleInviteCommand(ctx);
      return true;
    case 'instruction':
    case 'instructions':
      await require('./instructionHandler').handleInstructionCommand(ctx);
      return true;
    case 'support':
      await require('./supportHandler').handleSupportCommand(ctx);
      return true;
    default:
      return false;
  }
}

function registerCommandHandlers(bot) {
  bot.start(handleStartCommand);
  bot.help(handleHelpCommand);
  bot.command('deposit', handleDepositCommand);
  bot.command('withdraw', handleWithdrawCommand);

  bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (!msg?.text || msg.contact) return next();

    const entity = msg.entities?.[0];
    if (entity?.type === 'bot_command' && entity.offset === 0) {
      return next();
    }

    if (await handleFallbackCommand(ctx)) return;
    return next();
  });
}

async function setupBotCommands(bot) {
  try {
    await bot.telegram.setMyCommands(BOT_COMMANDS);
  } catch (err) {
    console.warn('[bot] setMyCommands failed:', err?.message || err);
  }

  try {
    await bot.telegram.setChatMenuButton({
      menuButton: { type: 'commands' },
    });
    console.log('[bot] Telegram menu button → Menu (command list)');
  } catch (err) {
    console.warn('[bot] setChatMenuButton failed:', err?.message || err);
  }
}

module.exports = {
  registerCommandHandlers,
  setupBotCommands,
  handleStartCommand,
  handleHelpCommand,
  HELP_MESSAGE,
  BOT_COMMANDS,
};
