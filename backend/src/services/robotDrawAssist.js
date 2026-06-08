/**
 * Robot-only draw assist — biases ball order so paid robots can bingo near the
 * configured advantage target. Falls back to random draws when assist is inactive.
 */
const { generateBingoCard } = require('../utils/bingoCard');
const { validateBingoClaim } = require('../utils/bingoWin');
const {
  clampRobotAdvantageLevel,
  getRobotTargetWinBallCount,
} = require('../utils/robotAdvantage');
const { MIN_CARTELAS_TO_PLAY } = require('../config/constants');
const settingsService = require('./settingsService');

/** Same winning patterns as bingoWin.js WIN_LINES (rows, cols, diagonals, four corners). */
const WIN_LINE_DEFS = [
  ...Array.from({ length: 5 }, (_, row) => ({
    pattern: 'horizontal',
    cells: [0, 1, 2, 3, 4].map((col) => `${row}-${col}`),
  })),
  ...Array.from({ length: 5 }, (_, col) => ({
    pattern: 'vertical',
    cells: [0, 1, 2, 3, 4].map((row) => `${row}-${col}`),
  })),
  {
    pattern: 'diagonal',
    cells: [0, 1, 2, 3, 4].map((i) => `${i}-${i}`),
  },
  {
    pattern: 'diagonal',
    cells: [0, 1, 2, 3, 4].map((i) => `${i}-${4 - i}`),
  },
  {
    pattern: 'four_corners',
    cells: ['0-0', '0-4', '4-0', '4-4'],
  },
];

/** @type {Map<string, object>} */
const roundPlans = new Map();

function parseCellKey(key) {
  const [row, col] = String(key).split('-').map(Number);
  return { row, col };
}

function getCartelLineOptions(cartelId) {
  const { grid } = generateBingoCard(cartelId);
  return WIN_LINE_DEFS.map(({ pattern, cells }) => {
    const entries = cells.map((key) => {
      const { row, col } = parseCellKey(key);
      const num = grid[row][col];
      const isFree = row === 2 && col === 2;
      return { row, col, num, isFree };
    });
    const numbers = entries
      .filter((entry) => !entry.isFree && entry.num != null)
      .map((entry) => Number(entry.num));
    return { numbers, size: numbers.length, pattern };
  });
}

/** Pick a random valid winning line for this cartela (horizontal, vertical, diagonal, or corners). */
function pickRandomCartelLine(cartelId) {
  const options = getCartelLineOptions(cartelId).filter(
    (line) => line.numbers.length > 0
  );
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}

function getPaidRobots(runtime, session) {
  return [...runtime.values()].filter((rt) => {
    if (!rt.paidForRound || !rt.currentRoundCartels?.length) return false;
    if (!session) return true;
    const player = session.players.get(rt.pseudoSocketId);
    const cartelCount = player?.cartelIds?.length ?? rt.currentRoundCartels.length;
    return (
      String(rt.pseudoSocketId).startsWith('robot-sock:') &&
      cartelCount >= MIN_CARTELAS_TO_PLAY
    );
  });
}

function buildPlanForRobot(rt, advantageLevel) {
  const targetBallCount = getRobotTargetWinBallCount(advantageLevel, rt.robotId);
  if (targetBallCount == null) return null;

  let best = null;
  for (const cartelId of rt.currentRoundCartels) {
    const line = pickRandomCartelLine(cartelId);
    if (!line) continue;
    if (
      !best ||
      line.size < best.lineNumbers.length ||
      targetBallCount < best.targetBallCount
    ) {
      best = {
        robotId: rt.robotId,
        pseudoSocketId: rt.pseudoSocketId,
        cartelId,
        lineNumbers: line.numbers,
        winPattern: line.pattern,
        targetBallCount,
      };
    }
  }
  return best;
}

function createRoundPlan(session, runtime, advantageLevel) {
  const level = clampRobotAdvantageLevel(advantageLevel);
  if (!session?.gameId || level <= 0) {
    roundPlans.delete(session?.gameId);
    return null;
  }

  const paid = getPaidRobots(runtime, session);
  if (!paid.length) {
    roundPlans.delete(session.gameId);
    return null;
  }

  let plan = null;
  for (const rt of paid) {
    const candidate = buildPlanForRobot(rt, level);
    if (!candidate) continue;
    if (
      !plan ||
      candidate.targetBallCount < plan.targetBallCount ||
      (candidate.targetBallCount === plan.targetBallCount &&
        candidate.lineNumbers.length < plan.lineNumbers.length)
    ) {
      plan = candidate;
    }
  }

  if (!plan) {
    roundPlans.delete(session.gameId);
    return null;
  }

  const biasStartBall = Math.max(
    1,
    plan.targetBallCount - plan.lineNumbers.length + 1
  );

  const fullPlan = {
    ...plan,
    gameId: session.gameId,
    advantageLevel: level,
    biasStartBall,
  };
  roundPlans.set(session.gameId, fullPlan);

  const owner = paid.find((rt) => rt.robotId === plan.robotId);
  if (owner) {
    owner.targetWinBallCount = plan.targetBallCount;
  }

  return fullPlan;
}

function refreshPlanTarget(session, runtime) {
  if (!session?.gameId) return null;

  const existing = getRoundPlan(session.gameId);
  const level = settingsService.getRobotAdvantageLevelSync();

  if (level <= 0) {
    return existing;
  }

  if (!existing) {
    return createRoundPlan(session, runtime, level);
  }

  const paid = getPaidRobots(runtime, session);
  const owner =
    paid.find((rt) => rt.robotId === existing.robotId) ??
    paid.find((rt) => rt.pseudoSocketId === existing.pseudoSocketId) ??
    paid[0];

  if (!owner) {
    clearRoundPlan(session.gameId);
    return null;
  }

  const targetBallCount = getRobotTargetWinBallCount(level, owner.robotId);
  existing.targetBallCount = targetBallCount;
  existing.advantageLevel = level;
  existing.biasStartBall = Math.max(
    1,
    targetBallCount - existing.lineNumbers.length + 1
  );
  owner.targetWinBallCount = targetBallCount;
  roundPlans.set(String(session.gameId), existing);
  return existing;
}

function clearRoundPlan(gameId) {
  if (gameId) roundPlans.delete(String(gameId));
}

function getRoundPlan(gameId) {
  if (!gameId) return null;
  return roundPlans.get(String(gameId)) ?? null;
}

function suggestNextBall(calledSet, session, runtime) {
  if (!session?.gameId) return null;

  let plan = getRoundPlan(session.gameId);
  const level = settingsService.getRobotAdvantageLevelSync();

  if (!plan) {
    if (level <= 0) return null;
    if (runtime) {
      plan = createRoundPlan(session, runtime, level);
    }
  }
  if (!plan) return null;

  if (runtime) {
    const refreshed = refreshPlanTarget(session, runtime);
    if (refreshed) plan = refreshed;
  }

  const calledLen = calledSet.size;
  const nextIdx = calledLen + 1;
  if (nextIdx > plan.targetBallCount) return null;

  const uncalledOnLine = plan.lineNumbers.filter((n) => !calledSet.has(n));
  if (!uncalledOnLine.length) {
    return null;
  }

  if (nextIdx >= plan.targetBallCount) {
    return uncalledOnLine[0];
  }

  if (nextIdx >= plan.biasStartBall) {
    return uncalledOnLine[Math.floor(Math.random() * uncalledOnLine.length)];
  }

  return null;
}

function canRobotClaimNow(rt, calledLen, advantageLevel) {
  const level = clampRobotAdvantageLevel(advantageLevel);
  if (level <= 0) return true;

  const target =
    rt.targetWinBallCount ??
    getRobotTargetWinBallCount(advantageLevel, rt.robotId);
  if (target == null) return true;
  return calledLen >= target;
}

function hasValidRobotBingo(cartelId, calledNumbers) {
  return validateBingoClaim(cartelId, calledNumbers, {}, true);
}

/**
 * Wrap bingoBall.drawNextBall so robot advantage can bias draws toward the
 * configured win ball count. Must use bingoBall.drawNextBall (not a destructured
 * import) in gameManager for this patch to apply.
 */
function installDrawAssist(getSession, getRuntime) {
  const bingoBall = require('../utils/bingoBall');
  if (bingoBall.__robotAssistPatched) return;

  const originalDrawNextBall = bingoBall.drawNextBall.bind(bingoBall);
  bingoBall.drawNextBall = (calledSet) => {
    try {
      const session = typeof getSession === 'function' ? getSession() : null;
      const runtime = typeof getRuntime === 'function' ? getRuntime() : null;
      const assisted = suggestNextBall(calledSet, session, runtime);
      if (assisted != null && !calledSet.has(assisted)) {
        return assisted;
      }
    } catch {
      /* fall back to random draw */
    }
    return originalDrawNextBall(calledSet);
  };
  bingoBall.__robotAssistPatched = true;
}

module.exports = {
  createRoundPlan,
  refreshPlanTarget,
  clearRoundPlan,
  getRoundPlan,
  suggestNextBall,
  canRobotClaimNow,
  hasValidRobotBingo,
  getCartelLineOptions,
  installDrawAssist,
};
