const { launchWithdrawBot } = require('./backend/src/withdrawBot');

launchWithdrawBot().catch((err) => {
  console.error('[withdraw-bot] failed to start:', err?.message || err);
  process.exit(1);
});
