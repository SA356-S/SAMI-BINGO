const { generateBingoCard } = require('./bingoCard');

function cellKey(row, col) {
  return `${row}-${col}`;
}

function lineKeys(cells) {
  return new Set(cells.map(([row, col]) => cellKey(row, col)));
}

const WIN_LINES = [
  ...Array.from({ length: 5 }, (_, row) =>
    lineKeys([0, 1, 2, 3, 4].map((col) => [row, col]))
  ),
  ...Array.from({ length: 5 }, (_, col) =>
    lineKeys([0, 1, 2, 3, 4].map((row) => [row, col]))
  ),
  lineKeys([0, 1, 2, 3, 4].map((i) => [i, i])),
  lineKeys([0, 1, 2, 3, 4].map((i) => [i, 4 - i])),
  lineKeys([
    [0, 0],
    [0, 4],
    [4, 0],
    [4, 4],
  ]),
];

function hasWinningLine(markedKeys) {
  return WIN_LINES.some((line) =>
    [...line].every((key) => markedKeys.has(key))
  );
}

function toCalledSet(calledNumbers) {
  const list = Array.isArray(calledNumbers)
    ? calledNumbers
    : calledNumbers instanceof Set
      ? [...calledNumbers]
      : [];
  return new Set(list.map(Number).filter((n) => Number.isFinite(n)));
}

function toManualMarkSet(manualMarks) {
  if (manualMarks instanceof Set) return manualMarks;
  if (Array.isArray(manualMarks)) return new Set(manualMarks.map(String));
  return new Set();
}

function getCartelMarkedKeys(cartelId, calledNumbers, manualMarks, automatic) {
  const { grid } = generateBingoCard(cartelId);
  const called = toCalledSet(calledNumbers);
  const manual = toManualMarkSet(manualMarks);
  const keys = new Set();

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cell = grid[row][col];
      const key = cellKey(row, col);

      if (row === 2 && col === 2) {
        keys.add(key);
        continue;
      }

      if (cell == null || !called.has(cell)) continue;

      if (automatic || manual.has(key)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function checkCartelWin(cartelId, calledNumbers, manualMarks, automatic) {
  const keys = getCartelMarkedKeys(
    cartelId,
    calledNumbers,
    manualMarks,
    automatic
  );
  return hasWinningLine(keys);
}

/**
 * Server-side Bingo validation against official called balls for this round.
 */
function validateBingoClaim(cartelId, calledNumbers, manualMarks, automatic) {
  const id = Number(cartelId);
  if (!Number.isInteger(id) || id < 1) return false;

  const marks =
    manualMarks == null
      ? []
      : manualMarks instanceof Set
        ? [...manualMarks]
        : Array.isArray(manualMarks)
          ? manualMarks
          : [];

  return checkCartelWin(id, calledNumbers, marks, Boolean(automatic));
}

module.exports = {
  validateBingoClaim,
  checkCartelWin,
  getCartelMarkedKeys,
};
