const SUPPORT_CONTACTS = [
  { username: 'Capital_bingoo', label: '@Capital_bingoo' },
  { username: 'Capibingo67', label: '@Capibingo67' },
];

function formatSupportMessageHtml() {
  const links = SUPPORT_CONTACTS.map(
    ({ username, label }) =>
      `<a href="https://t.me/${username}">${label}</a>`
  ).join(' / ');

  return `🛠️ Support: ${links}`;
}

async function sendSupportPage(ctx) {
  await ctx.reply(formatSupportMessageHtml(), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

async function handleSupportAction(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await sendSupportPage(ctx);
}

async function handleSupportCommand(ctx) {
  await sendSupportPage(ctx);
}

function registerSupportHandlers(bot) {
  bot.action('menu:support', handleSupportAction);
  bot.command('support', handleSupportCommand);
}

module.exports = {
  registerSupportHandlers,
  handleSupportCommand,
  sendSupportPage,
  SUPPORT_CONTACTS,
};
