/**
 * One-time cleanup: permanently remove all robot / system-generated players.
 *
 * Safe for real users — only deletes:
 *   - RobotProfile + RobotStats (entire collections)
 *   - Any record whose userId / robotId starts with "robot:"
 *
 * Does NOT touch TelegramUser, UserProfile, or real wallet rows.
 *
 * Usage:
 *   node scripts/purgeRobots.js --dry-run   # preview counts only
 *   node scripts/purgeRobots.js --confirm   # execute deletion
 *
 * Stop the backend server before running --confirm, then restart it so
 * in-memory game sessions, robot engine runtime, and wallet cache are cleared.
 */

const { loadEnv } = require('../src/config/env');
const { connectDatabase, mongoose } = require('../src/config/db');
const { RobotProfileModel } = require('../src/models/RobotProfile');
const { RobotStatsModel } = require('../src/models/RobotStats');
const { UserWalletModel } = require('../src/models/UserWallet');
const { PlayerStatsModel } = require('../src/models/PlayerStats');
const { GameHistoryModel } = require('../src/models/GameHistory');
const { WalletTransactionModel } = require('../src/models/WalletTransaction');
const { DepositModel } = require('../src/models/Deposit');

loadEnv();

const ROBOT_ID_FILTER = { $regex: /^robot:/ };

function isRobotUserId(userId) {
  return String(userId || '').startsWith('robot:');
}

async function countRobotRows(Model, field = 'userId') {
  return Model.countDocuments({ [field]: ROBOT_ID_FILTER });
}

async function preview() {
  const counts = {
    robotProfiles: await RobotProfileModel.countDocuments({}),
    robotStats: await RobotStatsModel.countDocuments({}),
    userWallets: await countRobotRows(UserWalletModel),
    playerStats: await countRobotRows(PlayerStatsModel),
    gameHistory: await countRobotRows(GameHistoryModel),
    walletTransactions: await countRobotRows(WalletTransactionModel),
    deposits: await countRobotRows(DepositModel),
  };

  return counts;
}

async function purge() {
  const results = {};

  const profileRes = await RobotProfileModel.deleteMany({});
  results.robotProfiles = profileRes.deletedCount ?? 0;

  const statsRes = await RobotStatsModel.deleteMany({});
  results.robotStats = statsRes.deletedCount ?? 0;

  const walletRes = await UserWalletModel.deleteMany({ userId: ROBOT_ID_FILTER });
  results.userWallets = walletRes.deletedCount ?? 0;

  const playerRes = await PlayerStatsModel.deleteMany({ userId: ROBOT_ID_FILTER });
  results.playerStats = playerRes.deletedCount ?? 0;

  const historyRes = await GameHistoryModel.deleteMany({ userId: ROBOT_ID_FILTER });
  results.gameHistory = historyRes.deletedCount ?? 0;

  const txRes = await WalletTransactionModel.deleteMany({ userId: ROBOT_ID_FILTER });
  results.walletTransactions = txRes.deletedCount ?? 0;

  const depositRes = await DepositModel.deleteMany({ userId: ROBOT_ID_FILTER });
  results.deposits = depositRes.deletedCount ?? 0;

  return results;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');

  if (!dryRun && !confirm) {
    console.log('Robot purge — pass --dry-run to preview or --confirm to delete.');
    console.log('Example: node scripts/purgeRobots.js --dry-run');
    process.exit(1);
  }

  await connectDatabase();

  const before = await preview();
  console.log('[purge-robots] Current robot-related rows:');
  for (const [key, count] of Object.entries(before)) {
    console.log(`  ${key}: ${count}`);
  }

  if (dryRun) {
    console.log('\n[purge-robots] Dry run — no rows deleted.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\n[purge-robots] Deleting…');
  console.log(
    '[purge-robots] Tip: stop the backend server before --confirm so the robot engine cannot recreate rows during purge.'
  );
  const deleted = await purge();

  console.log('[purge-robots] Deleted:');
  for (const [key, count] of Object.entries(deleted)) {
    console.log(`  ${key}: ${count}`);
  }

  const after = await preview();
  const remaining = Object.values(after).reduce((sum, n) => sum + n, 0);
  if (remaining > 0) {
    console.warn(`[purge-robots] Warning: ${remaining} robot-related rows still remain.`);
  } else {
    console.log('[purge-robots] All robot player data removed from the database.');
  }

  console.log(
    '\n[purge-robots] Restart the backend server to clear in-memory game rooms, robot engine runtime, and wallet cache.'
  );

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[purge-robots] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

module.exports = { isRobotUserId, preview, purge };
