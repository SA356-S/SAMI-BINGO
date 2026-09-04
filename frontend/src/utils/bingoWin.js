import { generateBingoCard } from './bingoCard.js';

/** Line bingo — win by one row, column, diagonal, or four corners (not full card). */

function cellKey(row, col) {
  return `${row}-${col}`;
}

function isCellMarked(row, col, markedKeys) {
  return markedKeys.has(cellKey(row, col));
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

function toCalledSet(calledNumbers) {
  const list =
    calledNumbers instanceof Set
      ? [...calledNumbers]
      : Array.isArray(calledNumbers)
        ? calledNumbers
        : [];
  return new Set(list.map(Number).filter((n) => Number.isFinite(n)));
}

function toManualMarkSet(manualMarks) {
  if (manualMarks instanceof Set) return manualMarks;
  if (Array.isArray(manualMarks)) return new Set(manualMarks.map(String));
  return new Set();
}

function getCartelGrid(cartelId, gridsByCartel = {}) {
  return gridsByCartel[cartelId] ?? gridsByCartel[String(cartelId)] ?? generateBingoCard(cartelId).grid;
}

function findCellKeysWithNumber(grid, number) {
  const keys = [];
  if (!grid || number == null) return keys;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (row === 2 && col === 2) continue;
      if (grid[row]?.[col] === number) keys.push(cellKey(row, col));
    }
  }
  return keys;
}

function marksForCartel(existingMarks, cartelId) {
  return toManualMarkSet(
    existingMarks?.[cartelId] ?? existingMarks?.[String(cartelId)]
  );
}

/**
 * Manual-mode only: toggle a tapped cell, and if that number is a called ball,
 * apply the same select/unselect to the same player's other cartelas that contain it.
 */
export function toggleManualMarkSynced({
  tappedCartelId,
  row,
  col,
  cartelIds,
  calledNumbers,
  gridsByCartel = {},
  existingMarks = {},
}) {
  if (row === 2 && col === 2) return existingMarks;

  const tappedId = Number(tappedCartelId);
  const tappedKey = cellKey(row, col);
  const tappedGrid = getCartelGrid(tappedId, gridsByCartel);
  const number = tappedGrid?.[row]?.[col];
  const selecting = !marksForCartel(existingMarks, tappedId).has(tappedKey);
  const called = toCalledSet(calledNumbers);
  const ownIds = [...new Set((cartelIds ?? []).map(Number).filter((id) => id >= 1))];
  const syncCalledNumber = number != null && called.has(number);
  const idsToUpdate = syncCalledNumber && ownIds.length > 0 ? ownIds : [tappedId];
  const next = { ...existingMarks };

  for (const id of idsToUpdate) {
    const set = new Set(marksForCartel(existingMarks, id));
    const keys =
      id === tappedId
        ? [tappedKey]
        : findCellKeysWithNumber(getCartelGrid(id, gridsByCartel), number);

    for (const key of keys) {
      if (selecting) set.add(key);
      else set.delete(key);
    }
    next[id] = set;
  }

  return next;
}

/** True if any winning line pattern is fully marked on this card. */
export function hasWinningLine(markedKeys) {
  return WIN_LINES.some((line) =>
    [...line].every((key) => markedKeys.has(key))
  );
}

/** Cell keys belonging to the first completed winning line. */
export function getWinningLineCellKeys(markedKeys) {
  for (const line of WIN_LINES) {
    if ([...line].every((key) => markedKeys.has(key))) {
      return line;
    }
  }
  return new Set();
}

/**
 * Official marks for Bingo validation — only free space and numbers already called.
 * Manual marks on uncalled cells do NOT count toward a win.
 */
export function getCartelMarkedKeys(
  cartelId,
  calledNumbers,
  manualMarks,
  automatic
) {
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

/** Display marks (includes manual taps on uncalled cells). */
export function getCartelDisplayMarkedKeys(
  cartelId,
  calledNumbers,
  manualMarks,
  automatic
) {
  const { grid } = generateBingoCard(cartelId);
  const called = toCalledSet(calledNumbers);
  const manual = toManualMarkSet(manualMarks);
  const keys = new Set(manual);

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cell = grid[row][col];
      const key = cellKey(row, col);

      if (row === 2 && col === 2) {
        keys.add(key);
      } else if (automatic && cell != null && called.has(cell)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

/** True when a line looks complete on-card but uses uncalled manual marks. */
export function hasFalseBingoClaim(
  cartelIds,
  calledNumbers,
  manualMarksByCartel,
  automatic
) {
  if (automatic) return false;

  for (const cartelId of cartelIds) {
    const manual =
      manualMarksByCartel?.[cartelId] ??
      manualMarksByCartel?.[String(cartelId)] ??
      manualMarksByCartel?.[Number(cartelId)];
    const display = getCartelDisplayMarkedKeys(
      cartelId,
      calledNumbers,
      manual,
      automatic
    );
    const valid = getCartelMarkedKeys(
      cartelId,
      calledNumbers,
      manual,
      automatic
    );

    if (hasWinningLine(display) && !hasWinningLine(valid)) {
      return true;
    }
  }

  return false;
}

/** Drop manual marks on uncalled cells; keep only called-number selections. */
export function pruneInvalidManualMarks(cartelIds, calledNumbers, existing = {}) {
  const called = toCalledSet(calledNumbers);
  const next = { ...existing };

  for (const cartelId of cartelIds) {
    const { grid } = generateBingoCard(cartelId);
    const prev = toManualMarkSet(existing[cartelId]);
    const set = new Set();

    for (const key of prev) {
      const [row, col] = key.split('-').map(Number);
      if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
      if (row === 2 && col === 2) continue;

      const cell = grid[row]?.[col];
      if (cell != null && called.has(cell)) {
        set.add(key);
      }
    }

    next[cartelId] = set;
  }

  return next;
}

/** Copy auto-daubed cells into manual marks when turning automatic off. */
export function snapshotAutoMarksForCartels(cartelIds, calledNumbers, existing = {}) {
  const called = toCalledSet(calledNumbers);
  const next = { ...existing };

  for (const cartelId of cartelIds) {
    const { grid } = generateBingoCard(cartelId);
    const set = new Set(next[cartelId] ?? []);

    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const cell = grid[row][col];
        if (row === 2 && col === 2) {
          set.add(cellKey(row, col));
        } else if (cell != null && called.has(cell)) {
          set.add(cellKey(row, col));
        }
      }
    }

    next[cartelId] = set;
  }

  return next;
}

export function checkCartelWin(cartelId, calledNumbers, manualMarks, automatic) {
  const keys = getCartelMarkedKeys(
    cartelId,
    calledNumbers,
    manualMarks,
    automatic
  );
  return hasWinningLine(keys);
}

/** First cartel id with a valid winning line (called numbers only), or null. */
export function findWinningCartel(
  cartelIds,
  calledNumbers,
  manualMarksByCartel,
  automatic
) {
  for (const cartelId of cartelIds) {
    const marks =
      manualMarksByCartel?.[cartelId] ??
      manualMarksByCartel?.[String(cartelId)] ??
      manualMarksByCartel?.[Number(cartelId)];
    if (checkCartelWin(cartelId, calledNumbers, marks, automatic)) {
      return cartelId;
    }
  }
  return null;
}

/** Mock other winners shown to all players (until live API). */
export const MOCK_ROUND_WINNERS = [
  { playerName: 'Arife Abdii', cartelId: 234 },
  { playerName: 'Sara Bekele', cartelId: 12 },
];

export function buildRoundWinners(localWinner) {
  const seen = new Set();
  const list = [];

  if (localWinner) {
    const label =
      localWinner.ownerLabel ??
      localWinner.playerName ??
      `Cartel #${localWinner.cartelId}`;
    list.push({ ...localWinner, isLocal: true, ownerLabel: label });
    seen.add(localWinner.cartelId);
  }

  for (const w of MOCK_ROUND_WINNERS) {
    if (!seen.has(w.cartelId)) {
      list.push({ ...w, isLocal: false });
      seen.add(w.cartelId);
    }
  }

  return list.slice(0, 3);
}
