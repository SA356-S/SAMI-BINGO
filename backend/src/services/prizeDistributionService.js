const { validateBingoClaim } = require('../utils/bingoWin');
const {
  creditBingoWin,
  emitWalletSnapshot,
  flushWalletPersists,
} = require('../socket/walletManager');
const { runDeferred } = require('../utils/eventLoopDefer');

function isRobotPlayer(player) {
  if (!player) return true;
  if (String(player.socketId || '').startsWith('robot-sock:')) return true;
  const userId = String(player.userId || '');
  return userId.startsWith('robot:');
}

function playerLabelFromCartelCount(cartelCount) {
  const n = Math.max(0, Number(cartelCount) || 0);
  return n > 0 ? `Player ${n}` : 'Player';
}

function getCartelManualMarks(player, cartelId) {
  return (
    player.manualMarks?.[String(cartelId)] ??
    player.manualMarks?.[cartelId] ??
    []
  );
}

/** Whole birr only — full pool for one winner; floor split for simultaneous winners. */
function computePrizeSharePerWinner(prizePool, winnerCount) {
  const count = Math.max(0, Math.floor(Number(winnerCount) || 0));
  const pool = Math.floor(Math.max(0, Number(prizePool) || 0));
  if (count <= 0) return 0;
  if (count === 1) return pool;
  return Math.floor(pool / count);
}

/**
 * All human players with a valid bingo on the current calledNumbers snapshot.
 * One entry per user (first winning cartela wins for display).
 */
function findSimultaneousHumanWinners(session) {
  if (!session?.calledNumbers?.length) return [];

  const calledNumbers = session.calledNumbers;
  const winners = [];
  const seenUserIds = new Set();

  for (const player of session.allSeatedPlayers()) {
    if (isRobotPlayer(player)) continue;

    const userId = String(player.userId || player.socketId);
    if (seenUserIds.has(userId)) continue;

    let winningCartelId = null;
    for (const cartelId of player.cartelIds ?? []) {
      const marks = getCartelManualMarks(player, cartelId);
      if (validateBingoClaim(cartelId, calledNumbers, marks, player.automatic)) {
        winningCartelId = Number(cartelId);
        break;
      }
    }

    if (winningCartelId == null) continue;

    seenUserIds.add(userId);
    const cartelCount = player.cartelIds?.length ?? 0;
    const fallbackLabel = playerLabelFromCartelCount(cartelCount);
    winners.push({
      userId,
      socketId: player.socketId,
      cartelId: winningCartelId,
      playerName:
        player.playerName && String(player.playerName).trim()
          ? String(player.playerName).trim()
          : fallbackLabel,
    });
  }

  return winners;
}

function creditHumanWinners(io, humanWinners, sharePerWinner, prizePool = 0) {
  if (!humanWinners.length) {
    return { totalPaid: 0, distributions: [] };
  }

  const pool = Math.floor(Math.max(0, Number(prizePool) || 0));
  const wholeShare =
    humanWinners.length <= 1
      ? pool
      : Math.floor(Math.max(0, Number(sharePerWinner) || 0));

  if (wholeShare <= 0) {
    return { totalPaid: 0, distributions: [] };
  }

  const distributions = [];
  const persistUserIds = [];
  const snapshotTargets = [];

  for (const winner of humanWinners) {
    const result = creditBingoWin(winner.userId, wholeShare, { deferPersist: true });
    persistUserIds.push(winner.userId);
    snapshotTargets.push({ winner, wallet: result.wallet });
    distributions.push({
      userId: winner.userId,
      socketId: winner.socketId,
      cartelId: winner.cartelId,
      amount: wholeShare,
    });
  }

  flushWalletPersists(persistUserIds);

  runDeferred(() => {
    for (const { winner, wallet } of snapshotTargets) {
      const socket = io?.sockets?.sockets?.get?.(winner.socketId);
      if (socket) {
        emitWalletSnapshot(socket, wallet);
      }
    }
  });

  return {
    totalPaid: wholeShare * humanWinners.length,
    distributions,
  };
}

/**
 * Resolve simultaneous human winners and credit prize shares at win lock time.
 * @returns {{ humanWinners: object[], prizeSharePerWinner: number, totalPaid: number, humanWinnerIds: string[] }}
 */
function distributeHumanPrizesAtWinMoment(session, io) {
  const prizePool = Math.floor(Math.max(0, Number(session.derash) || 0));
  const humanWinners = findSimultaneousHumanWinners(session);
  const prizeSharePerWinner = computePrizeSharePerWinner(
    prizePool,
    humanWinners.length
  );

  const { totalPaid } = creditHumanWinners(
    io,
    humanWinners,
    prizeSharePerWinner,
    prizePool
  );

  return {
    humanWinners,
    humanWinnerIds: humanWinners.map((w) => w.userId),
    humanWinnerCount: humanWinners.length,
    prizeSharePerWinner,
    prizePool,
    totalPaid,
    winners: humanWinners.map((w) => ({
      playerName: w.playerName,
      cartelId: w.cartelId,
      userId: w.userId,
      prize:
        humanWinners.length <= 1
          ? prizePool
          : prizeSharePerWinner,
    })),
  };
}

module.exports = {
  computePrizeSharePerWinner,
  findSimultaneousHumanWinners,
  distributeHumanPrizesAtWinMoment,
};
