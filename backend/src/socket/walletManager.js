const {
  GAME_ENTRY_STAKE,
  HOUSE_COMMISSION_RATE,
  MIN_TOTAL_CARTELAS_TO_START,
} = require('../config/constants');

const { resolveTelegramUserId, isValidTelegramId } = require('../utils/telegramAuth');
const {
  isDbReady,
  loadWalletFromDb,
  saveWalletToDb,
  creditPlayWalletDb,
  debitPlayWalletDb,
  creditMainWalletDb,
  debitMainWalletDb,
  hydrateAllWalletsFromDb,
} = require('../services/walletPersistenceService');

const robotBankService = require('../services/robotBankService');

function isRobotUserId(userId) {
  return String(userId || '').startsWith('robot:');
}

/**
 * L1 cache — always synced to MongoDB UserWallet on mutation and hydrated on startup.
 * main — winnings (Bingo prizes), withdrawable
 * play — deposits / play money
 */

/** @type {Map<string, { main: number, play: number }>} */
const walletsByUser = new Map();

/** @type {Map<string, Promise<{ main: number, play: number }>>} */
const loadPromises = new Map();

const INITIAL_PLAY_WALLET = 0;
const INITIAL_MAIN_WALLET = 0;

function setCacheEntry(userId, wallet) {
  walletsByUser.set(String(userId), {
    main: Math.max(0, Number(wallet.main) || 0),
    play: Math.max(0, Number(wallet.play) || 0),
  });
}

function logPersistError(userId, err) {
  console.error(
    `[wallet] persist failed userId=${userId}:`,
    err?.message ?? err
  );
}

/**
 * Load wallet from DB into cache (deduped per user).
 */
async function ensureWalletLoaded(userId) {
  const key = String(userId);
  if (walletsByUser.has(key) && !loadPromises.has(key)) {
    return walletsByUser.get(key);
  }

  if (loadPromises.has(key)) {
    return loadPromises.get(key);
  }

  const promise = (async () => {
    const fromDb = await loadWalletFromDb(key);
    setCacheEntry(key, fromDb);
    return walletsByUser.get(key);
  })();

  loadPromises.set(key, promise);

  try {
    return await promise;
  } finally {
    loadPromises.delete(key);
  }
}

function persistWalletAsync(userId, extras = {}) {
  const key = String(userId);
  const wallet = walletsByUser.get(key);
  if (!wallet || !isDbReady()) return Promise.resolve(null);
  return saveWalletToDb(key, wallet, extras).catch((err) => {
    logPersistError(key, err);
    return null;
  });
}

function resolveUserId(socket, payload = {}) {
  const resolved = resolveTelegramUserId({
    payload,
    auth: socket.handshake?.auth ?? {},
    data: socket.data ?? {},
  });
  if (resolved?.userId) return resolved.userId;

  const fromVerifiedSession =
    socket.data?.telegramUserId ?? socket.data?.userId;
  if (isValidTelegramId(fromVerifiedSession)) {
    return String(fromVerifiedSession).trim();
  }

  return String(socket.id);
}

function getOrInitWallet(userId) {
  const key = String(userId);
  if (!walletsByUser.has(key)) {
    setCacheEntry(key, { main: INITIAL_MAIN_WALLET, play: INITIAL_PLAY_WALLET });
    void ensureWalletLoaded(key).catch((err) => logPersistError(key, err));
  }
  return walletsByUser.get(key);
}

function toSnapshot(wallet) {
  const main = Math.max(0, Number(wallet.main) || 0);
  const play = Math.max(0, Number(wallet.play) || 0);
  const totalWalletBalance = main + play;
  return {
    mainWallet: main,
    playWallet: play,
    totalWalletBalance,
    wallets: { main, play, total: totalWalletBalance },
  };
}

/** REST + client wallet payload for a user account */
function getWalletBalance(userId) {
  const wallet = userId ? getOrInitWallet(String(userId)) : { main: 0, play: 0 };
  return {
    ok: true,
    userId: userId ? String(userId) : null,
    ...toSnapshot(wallet),
  };
}

async function getWalletBalanceAsync(userId) {
  const key = String(userId || '');
  if (!key) {
    return { ok: true, userId: null, mainWallet: 0, playWallet: 0, totalWalletBalance: 0 };
  }

  if (isDbReady()) {
    const fromDb = await loadWalletFromDb(key);
    setCacheEntry(key, fromDb);
    return {
      ok: true,
      userId: key,
      ...toSnapshot(fromDb),
    };
  }

  const wallet = await ensureWalletLoaded(key);
  return {
    ok: true,
    userId: key,
    ...toSnapshot(wallet),
  };
}

function creditDeposit(userId, amount) {
  const key = String(userId);
  const wallet = getOrInitWallet(key);
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) {
    return { ok: false, error: 'Invalid deposit amount', wallet };
  }

  wallet.play += value;
  void persistWalletAsync(key);
  return { ok: true, wallet, credited: value };
}

/** @deprecated alias */
function creditDepositSync(userId, amount) {
  return creditDeposit(userId, amount);
}

async function creditDepositAsync(userId, amount, meta = {}) {
  const key = String(userId);
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) {
    return { ok: false, error: 'Invalid deposit amount' };
  }

  if (!isDbReady()) {
    const wallet = getOrInitWallet(key);
    wallet.play += value;
    return { ok: true, wallet, credited: value, persisted: false };
  }

  const result = await creditPlayWalletDb(key, value, meta);
  if (!result.ok) return result;

  setCacheEntry(key, result.wallet);
  return { ok: true, wallet: result.wallet, credited: result.credited, persisted: true };
}

function debitWithdraw(userId, amount) {
  const key = String(userId);
  const wallet = getOrInitWallet(key);
  const value = Math.max(0, Number(amount) || 0);

  if (value <= 0) {
    return { ok: false, error: 'Invalid withdraw amount', wallet };
  }
  if (wallet.main < value) {
    return {
      ok: false,
      error: 'Insufficient main wallet balance',
      wallet,
      required: value,
      available: wallet.main,
    };
  }

  wallet.main -= value;
  void persistWalletAsync(key);
  return { ok: true, wallet, withdrawn: value };
}

/** Atomic main-wallet debit — persists to MongoDB before returning. */
async function debitWithdrawAsync(userId, amount) {
  const key = String(userId);
  const value = Math.max(0, Number(amount) || 0);

  if (value <= 0) {
    return { ok: false, error: 'Invalid withdraw amount' };
  }

  if (!isDbReady()) {
    return debitWithdraw(userId, amount);
  }

  const result = await debitMainWalletDb(key, value);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      wallet: result.wallet ?? getOrInitWallet(key),
      required: result.required,
      available: result.available,
    };
  }

  setCacheEntry(key, result.wallet);
  return {
    ok: true,
    wallet: result.wallet,
    withdrawn: result.withdrawn,
    persisted: true,
  };
}

function creditBingoWin(userId, amount) {
  const key = String(userId);
  const wallet = getOrInitWallet(key);
  const value = Math.floor(Math.max(0, Number(amount) || 0));
  if (value <= 0) {
    return { ok: false, error: 'Invalid prize amount', wallet };
  }

  wallet.main += value;
  void persistWalletAsync(key);
  return { ok: true, wallet, credited: value };
}

/**
 * Deduct from Play Wallet first, then fall back to Main Wallet.
 * Main Wallet should behave like Play Wallet for gameplay charges.
 */
function deductGameplayBalance(userId, amount) {
  const key = String(userId);
  const wallet = getOrInitWallet(key);
  const value = Math.max(0, Number(amount) || 0);

  if (value <= 0) {
    return { ok: false, error: 'Invalid deduction amount', wallet };
  }

  const play = Math.max(0, Number(wallet.play) || 0);
  const main = Math.max(0, Number(wallet.main) || 0);
  const total = play + main;

  if (total < value) {
    return {
      ok: false,
      error: 'Insufficient wallet balance',
      wallet,
      required: value,
      available: total,
      availablePlay: play,
      availableMain: main,
    };
  }

  const fromPlay = Math.min(play, value);
  const remaining = value - fromPlay;
  const fromMain = remaining > 0 ? Math.min(main, remaining) : 0;

  wallet.play = play - fromPlay;
  wallet.main = main - fromMain;
  void persistWalletAsync(key);

  return {
    ok: true,
    wallet,
    deducted: value,
    from: { play: fromPlay, main: fromMain },
  };
}

/** Preflight — main + play must cover stake × cartel count (no deduction). */
function canAffordGameplayEntry(userId, cartelCount, stake = GAME_ENTRY_STAKE) {
  if (isRobotUserId(userId)) {
    return { ok: true, required: 0, available: Infinity, wallet: null };
  }

  const count = Math.max(0, Number(cartelCount) || 0);
  const required = count * Math.max(0, Number(stake) || GAME_ENTRY_STAKE);
  if (required <= 0) {
    return { ok: true, required: 0, available: 0, wallet: getOrInitWallet(userId) };
  }

  const wallet = getOrInitWallet(userId);
  const play = Math.max(0, Number(wallet.play) || 0);
  const main = Math.max(0, Number(wallet.main) || 0);
  const available = play + main;

  if (available < required) {
    return {
      ok: false,
      error: 'insufficient_balance',
      message: 'Insufficient balance',
      wallet,
      required,
      available,
      availablePlay: play,
      availableMain: main,
    };
  }

  return { ok: true, required, available, wallet };
}

function deductPlayWallet(userId, amount) {
  const key = String(userId);
  const wallet = getOrInitWallet(key);
  const value = Math.max(0, Number(amount) || 0);

  if (value <= 0) {
    return { ok: false, error: 'Invalid deduction amount', wallet };
  }
  if (wallet.play < value) {
    return {
      ok: false,
      error: 'Insufficient play wallet balance',
      wallet,
      required: value,
      available: wallet.play,
    };
  }

  wallet.play -= value;
  void persistWalletAsync(key);
  return { ok: true, wallet, deducted: value };
}

/**
 * Sum of stake × cartels across all seated players (preview or settled pool).
 */
function computeTotalPool(session) {
  return [...session.players.values()].reduce(
    (sum, player) => sum + player.cartelIds.length * session.stake,
    0
  );
}

function splitPool(totalPool) {
  const pool = Math.max(0, Math.floor(Number(totalPool) || 0));
  const houseShare = Math.floor(pool * HOUSE_COMMISSION_RATE);
  const prizePool = pool - houseShare;
  return { totalPool: pool, houseShare, prizePool };
}

/**
 * Charge every player with cartels when the round starts.
 */
function chargeSessionEntryStakes(session, io) {
  if (session.stakesCharged) {
    return {
      ok: true,
      alreadyCharged: true,
      totalPool: session.totalPool,
      houseShare: session.houseShare,
      prizePool: session.prizePool,
    };
  }

  if (
    typeof session.getTotalSelectedCartelas === 'function'
      ? session.getTotalSelectedCartelas() < MIN_TOTAL_CARTELAS_TO_START
      : session.takenCartels?.size < MIN_TOTAL_CARTELAS_TO_START
  ) {
    return { ok: false, error: 'Not enough cartels to start' };
  }

  const playersToCharge = [...session.players.values()].filter(
    (p) => p.cartelIds.length >= 1
  );

  if (playersToCharge.length === 0) {
    return { ok: false, error: 'No cartels to charge' };
  }

  const pendingHumans = [];
  const pendingRobots = [];
  let totalRobotStake = 0;

  for (const player of playersToCharge) {
    const userId = player.userId || player.socketId;
    const cartelCount = player.cartelIds.length;
    const amount = cartelCount * session.stake;

    if (isRobotUserId(userId)) {
      pendingRobots.push({ player, userId, amount });
      totalRobotStake += amount;
    } else {
      const wallet = getOrInitWallet(userId);
      pendingHumans.push({ player, userId, amount, wallet });
    }
  }

  // Preflight humans (no bank changes yet).
  for (const { userId, amount, wallet } of pendingHumans) {
    const play = Math.max(0, Number(wallet.play) || 0);
    const main = Math.max(0, Number(wallet.main) || 0);
    const total = play + main;
    if (total < amount) {
      return {
        ok: false,
        error: 'Insufficient wallet balance',
        userId,
        required: amount,
        available: total,
        availablePlay: play,
        availableMain: main,
      };
    }
  }

  // Preflight robots (robot bank uses robotConfigService memory + async persist).
  if (pendingRobots.length > 0) {
    const bankBalance = robotBankService.getBalanceSync();
    if (bankBalance < totalRobotStake) {
      return {
        ok: false,
        error: 'Insufficient robot bank balance',
        required: totalRobotStake,
        available: bankBalance,
      };
    }
    const deducted = robotBankService.deductSync(totalRobotStake);
    if (!deducted?.ok) {
      return {
        ok: false,
        error: deducted?.error ?? 'Insufficient robot bank balance',
        required: totalRobotStake,
      };
    }
  }

  // Deduct humans after robot bank preflight.
  for (const { player, userId, amount } of pendingHumans) {
    const result = deductGameplayBalance(userId, amount);
    if (!result.ok) return result;

    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) emitWalletSnapshot(socket, result.wallet);
  }

  const totalPool = computeTotalPool(session);
  const { houseShare, prizePool } = splitPool(totalPool);

  session.stakesCharged = true;
  session.totalPool = totalPool;
  session.houseShare = houseShare;
  session.prizePool = prizePool;

  console.log(
    `[wallet] game start gameId=${session.gameId} pool=${totalPool} house=${houseShare} derash=${prizePool}`
  );

  try {
    const { recordSessionStart } = require('../services/statsService');
    recordSessionStart(session).catch((err) =>
      console.warn('[stats] recordSessionStart failed', err.message)
    );
  } catch {
    /* stats optional */
  }

  return { ok: true, totalPool, houseShare, prizePool };
}

function chargeAndStartSession(session, io, options = {}) {
  const { gameManager } = require('./gameManager');
  const lobby = gameManager.getLobbySession();
  const target = lobby ?? session;

  if (target.status === 'calling' && target.drawTimer) {
    return {
      ok: true,
      alreadyRunning: true,
      alreadyCharged: target.stakesCharged,
      totalPool: target.totalPool,
      houseShare: target.houseShare,
      prizePool: target.prizePool,
      gameId: target.gameId,
    };
  }

  const forceStart = options.forceStart === true;
  const hasReadyCartels =
    typeof target.hasMinimumCartelasToStart === 'function'
      ? target.hasMinimumCartelasToStart()
      : typeof target.getTotalSelectedCartelas === 'function'
        ? target.getTotalSelectedCartelas() >= MIN_TOTAL_CARTELAS_TO_START
        : (target.takenCartels?.size ?? 0) >= MIN_TOTAL_CARTELAS_TO_START;
  const canStart = forceStart ? hasReadyCartels : target.canStartCalling();

  if (!canStart) {
    return { ok: false, error: 'Cannot start game yet' };
  }

  const charge = chargeSessionEntryStakes(target, io);
  if (!charge.ok) {
    return charge;
  }

  const started = target.startCalling(io, options);
  if (!started?.ok) {
    return { ok: false, error: started?.error ?? 'Failed to start ball caller' };
  }

  // Prevent duplicate pool updates if multiple clients triggered "start" concurrently.
  if (!started?.alreadyRunning) {
    io.to(target.roomName).emit('game:pool-update', {
      gameId: target.gameId,
      totalPool: target.totalPool,
      houseShare: target.houseShare,
      derash: target.derash,
      pot: target.derash,
    });
  }

  return {
    ok: true,
    ...charge,
    gameId: target.gameId,
    alreadyRunning: started?.alreadyRunning,
  };
}

function emitWalletSnapshot(socket, wallet) {
  socket.emit('wallet:update', toSnapshot(wallet));
}

async function hydrateWalletCacheFromDb() {
  return hydrateAllWalletsFromDb(setCacheEntry);
}

module.exports = {
  walletsByUser,
  resolveUserId,
  getOrInitWallet,
  ensureWalletLoaded,
  toSnapshot,
  getWalletBalance,
  getWalletBalanceAsync,
  creditDeposit,
  creditDepositAsync,
  debitWithdraw,
  debitWithdrawAsync,
  creditBingoWin,
  deductGameplayBalance,
  canAffordGameplayEntry,
  deductPlayWallet,
  computeTotalPool,
  splitPool,
  chargeSessionEntryStakes,
  chargeAndStartSession,
  emitWalletSnapshot,
  hydrateWalletCacheFromDb,
  persistWalletAsync,
  GAME_ENTRY_STAKE,
  HOUSE_COMMISSION_RATE,
};
