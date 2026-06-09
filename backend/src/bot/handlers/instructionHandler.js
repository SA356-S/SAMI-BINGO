const { Markup } = require('telegraf');
const { getMiniAppUrl } = require('../../config/miniAppUrl');
const {
  INSTRUCTION_TITLE,
  INSTRUCTION_SECTIONS,
} = require('../content/instructionContent');

function getInstructionPageUrl() {
  return `${getMiniAppUrl()}/instruction`;
}

function formatInstructionChatText() {
  const lines = [`📖 ${INSTRUCTION_TITLE}`, ''];

  for (const section of INSTRUCTION_SECTIONS) {
    lines.push(`${section.icon} ${section.title}`);
    section.items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    lines.push('');
  }

  return lines.join('\n').trim();
}

function instructionReplyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.webApp('📖 Open Instructions', getInstructionPageUrl()),
    ],
  ]);
}

async function sendInstructionPage(ctx) {
  await ctx.reply(formatInstructionChatText(), {
    ...instructionReplyKeyboard(),
    disable_web_page_preview: true,
  });
}

async function handleInstructionAction(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await sendInstructionPage(ctx);
}

async function handleInstructionCommand(ctx) {
  await sendInstructionPage(ctx);
}

function registerInstructionHandlers(bot) {
  bot.action('menu:instruction', handleInstructionAction);
  bot.command('instruction', handleInstructionCommand);
  bot.command('instructions', handleInstructionCommand);
}

module.exports = {
  registerInstructionHandlers,
  handleInstructionCommand,
  sendInstructionPage,
  getInstructionPageUrl,
};
