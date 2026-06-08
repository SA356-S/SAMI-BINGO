const BASE_MARKING_DELAY_MS = 1000;
const BASE_PATTERN_CHECK_INTERVAL_MS = 1000;
const BASE_CLAIM_DELAY_MS = 800;

const MIN_MARKING_DELAY_MS = 50;
const MIN_PATTERN_CHECK_INTERVAL_MS = 100;
const MIN_CLAIM_DELAY_MS = 0;

/** Anchor levels map to typical robot win ball counts. */
const ADVANTAGE_WIN_BALL_ANCHORS = [
  { level: 0, target: null },
  { level: 20, target: 20 },
  { level: 40, target: 15 },
  { level: 60, targetMin: 9, targetMax: 13 },
  { level: 80, targetMin: 6, targetMax: 9 },
  { level: 100, target: 5 },
];

function clampRobotAdvantageLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function hashSeed(value) {
  const s = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomIntFromSeed(min, max, seed) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (hi <= lo) return lo;
  const span = hi - lo + 1;
  return lo + (hashSeed(seed) % span);
}

function findAnchor(level) {
  const l = clampRobotAdvantageLevel(level);
  for (let i = ADVANTAGE_WIN_BALL_ANCHORS.length - 1; i >= 0; i -= 1) {
    if (l >= ADVANTAGE_WIN_BALL_ANCHORS[i].level) return ADVANTAGE_WIN_BALL_ANCHORS[i];
  }
  return ADVANTAGE_WIN_BALL_ANCHORS[0];
}

function findNextAnchor(level) {
  const l = clampRobotAdvantageLevel(level);
  for (const anchor of ADVANTAGE_WIN_BALL_ANCHORS) {
    if (anchor.level > l) return anchor;
  }
  return null;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Typical win ball count for an advantage level (no per-robot jitter).
 */
function getTypicalWinBallCount(level) {
  const l = clampRobotAdvantageLevel(level);
  if (l <= 0) return null;

  const current = findAnchor(l);
  const next = findNextAnchor(l);

  if (current.targetMin != null && current.targetMax != null) {
    return Math.round((current.targetMin + current.targetMax) / 2);
  }

  if (!next) {
    return current.target ?? 5;
  }

  const span = next.level - current.level;
  const t = span > 0 ? (l - current.level) / span : 0;

  const fromTarget =
    current.target ??
    (current.targetMin != null && current.targetMax != null
      ? (current.targetMin + current.targetMax) / 2
      : 75);
  const toTarget =
    next.target ??
    (next.targetMin != null && next.targetMax != null
      ? (next.targetMin + next.targetMax) / 2
      : fromTarget);

  return Math.max(5, Math.min(75, Math.round(lerp(fromTarget, toTarget, t))));
}

/**
 * Per-robot target win ball count for the active advantage level.
 */
function getRobotTargetWinBallCount(level, robotSeed = '') {
  const l = clampRobotAdvantageLevel(level);
  if (l <= 0) return null;

  const anchor = findAnchor(l);
  if (anchor.targetMin != null && anchor.targetMax != null) {
    return randomIntFromSeed(anchor.targetMin, anchor.targetMax, `${robotSeed}:${l}`);
  }

  const typical = getTypicalWinBallCount(l);
  if (typical == null) return null;

  // Small jitter keeps wins natural while staying near the configured target.
  const jitter = randomIntFromSeed(-1, 1, `${robotSeed}:jitter:${l}`);
  return Math.max(5, Math.min(75, typical + jitter));
}

function getTargetWinBallCountRange(level) {
  const l = clampRobotAdvantageLevel(level);
  if (l <= 0) return { min: null, max: null, typical: null };

  const anchor = findAnchor(l);
  if (anchor.targetMin != null && anchor.targetMax != null) {
    return {
      min: anchor.targetMin,
      max: anchor.targetMax,
      typical: Math.round((anchor.targetMin + anchor.targetMax) / 2),
    };
  }

  const typical = getTypicalWinBallCount(l);
  return { min: typical, max: typical, typical };
}

function getRobotAdvantageEffectLabel(level) {
  const l = clampRobotAdvantageLevel(level);
  if (l <= 0) return 'FAIR';
  if (l <= 25) return 'LOW';
  if (l <= 60) return 'MEDIUM';
  return 'HIGH';
}

function buildRobotAdvantagePreview(level) {
  const robotAdvantageLevel = clampRobotAdvantageLevel(level);
  const range = getTargetWinBallCountRange(robotAdvantageLevel);

  return {
    robotAdvantageLevel,
    targetWinBallCount: range.typical,
    targetWinBallCountMin: range.min,
    targetWinBallCountMax: range.max,
    effectLabel: getRobotAdvantageEffectLabel(robotAdvantageLevel),
    // Legacy timing fields — kept for API compatibility; robots now use ball-count targets.
    speedMultiplier: 1,
    markingDelayMs: getRobotMarkingDelayMs(robotAdvantageLevel),
    patternCheckIntervalMs: getRobotPatternCheckIntervalMs(robotAdvantageLevel),
    claimDelayMs: getRobotClaimDelayMs(robotAdvantageLevel),
  };
}

/** Robots mark balls immediately once eligible to evaluate a win. */
function getRobotMarkingDelayMs(level) {
  const target = getTypicalWinBallCount(level);
  return target == null ? BASE_MARKING_DELAY_MS : MIN_MARKING_DELAY_MS;
}

function getRobotPatternCheckIntervalMs(level) {
  const target = getTypicalWinBallCount(level);
  return target == null ? BASE_PATTERN_CHECK_INTERVAL_MS : MIN_PATTERN_CHECK_INTERVAL_MS;
}

function getRobotClaimDelayMs(level) {
  const target = getTypicalWinBallCount(level);
  return target == null ? BASE_CLAIM_DELAY_MS : MIN_CLAIM_DELAY_MS;
}

module.exports = {
  ADVANTAGE_WIN_BALL_ANCHORS,
  BASE_MARKING_DELAY_MS,
  BASE_PATTERN_CHECK_INTERVAL_MS,
  BASE_CLAIM_DELAY_MS,
  clampRobotAdvantageLevel,
  getTypicalWinBallCount,
  getRobotTargetWinBallCount,
  getTargetWinBallCountRange,
  getRobotMarkingDelayMs,
  getRobotPatternCheckIntervalMs,
  getRobotClaimDelayMs,
  getRobotAdvantageEffectLabel,
  buildRobotAdvantagePreview,
};
