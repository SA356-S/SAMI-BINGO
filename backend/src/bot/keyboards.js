const { Markup } = require('telegraf');
const { getMiniAppUrl } = require('../config/miniAppUrl');
const { GAME_ENTRY_STAKE } = require('../config/constants');

const SHARE_CONTACT_LABEL = '📞 Share contact';

const WELCOME_MESSAGE = '👋 Welcome back to Capital Bingo!';

const PLAY_STAKE_MESSAGE = 'Choose your stake to play';

function parseStakeOptions() {
  const raw = process.env.BOT_STAKE_OPTIONS;
  if (raw && String(raw).trim()) {
    const parsed = String(raw)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length > 0) return parsed;
  }
  return [GAME_ENTRY_STAKE];
}

/** Original stable Mini App open — plain MINI_APP_URL, no query params. */
function playWebAppButton(label) {
  return {
    text: label,
    web_app: { url: getMiniAppUrl() },
  };
}

function contactRequestKeyboard() {
  return Markup.keyboard([[Markup.button.contactRequest(SHARE_CONTACT_LABEL)]])
    .resize()
    .oneTime();
}

function removeKeyboardExtra() {
  return Markup.removeKeyboard();
}

/** /start — welcome + main menu (Play uses callback, not web_app here). */
function welcomeInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎮 Play', 'menu:play')],
    [
      Markup.button.callback('Balance 💵', 'menu:balance'),
      Markup.button.callback('Deposit 💰', 'menu:deposit'),
    ],
    [
      Markup.button.callback('Contact Support...', 'menu:support'),
      Markup.button.callback('Instruction 📖', 'menu:instruction'),
    ],
    [
      Markup.button.callback('Invite 🔗', 'menu:invite'),
      Markup.button.callback('Withdraw 🤑', 'menu:withdraw'),
    ],
  ]);
}

function welcomeReply() {
  return welcomeInlineKeyboard();
}

/** Stake step — each button opens the Mini App with the original URL. */
function stakeSelectionInlineKeyboard() {
  const stakes = parseStakeOptions();
  const rows = stakes.map((stake) => [
    playWebAppButton(stake === GAME_ENTRY_STAKE ? '🎮 Play' : `Play ${stake} ETB`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function stakeSelectionReply() {
  return stakeSelectionInlineKeyboard();
}

module.exports = {
  SHARE_CONTACT_LABEL,
  WELCOME_MESSAGE,
  PLAY_STAKE_MESSAGE,
  contactRequestKeyboard,
  removeKeyboardExtra,
  playWebAppButton,
  welcomeInlineKeyboard,
  welcomeReply,
  stakeSelectionInlineKeyboard,
  stakeSelectionReply,
};
