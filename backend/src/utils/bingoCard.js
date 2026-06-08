/** B-I-N-G-O column ranges — mirrors frontend/src/utils/bingoCard.js */
const BINGO_COLUMNS = [
  { letter: 'B', min: 1, max: 15 },
  { letter: 'I', min: 16, max: 30 },
  { letter: 'N', min: 31, max: 45 },
  { letter: 'G', min: 46, max: 60 },
  { letter: 'O', min: 61, max: 75 },
];

/** Same static occupancy list as frontend getMockOtherCartels */
const FIXED_OTHER_CARTELS = [
  45, 78, 102, 156, 201, 234, 267, 289, 310, 321, 345, 357, 358, 373, 378,
  88, 145, 199, 256, 312, 367, 389,
];

function mulberry32(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shufflePick(min, max, count, rng) {
  const pool = [];
  for (let n = min; n <= max; n += 1) pool.push(n);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/**
 * Deterministic 5×5 bingo card for a cartel id.
 * Center cell is free (null). Each column respects B-I-N-G-O ranges.
 * @returns {{ cartelId: number, grid: (number|null)[][] }}
 */
function generateBingoCard(cartelId) {
  const rng = mulberry32(cartelId * 7919 + 104729);

  const columnNumbers = BINGO_COLUMNS.map(({ min, max }, colIndex) => {
    const pickCount = colIndex === 2 ? 4 : 5;
    return shufflePick(min, max, pickCount, rng);
  });

  const grid = Array.from({ length: 5 }, () => Array(5).fill(null));

  for (let col = 0; col < 5; col += 1) {
    let pickIndex = 0;
    for (let row = 0; row < 5; row += 1) {
      if (col === 2 && row === 2) {
        grid[row][col] = null;
      } else {
        grid[row][col] = columnNumbers[col][pickIndex];
        pickIndex += 1;
      }
    }
  }

  return { cartelId, grid };
}

function getMockOtherCartels() {
  return [...FIXED_OTHER_CARTELS];
}

module.exports = {
  BINGO_COLUMNS,
  generateBingoCard,
  getMockOtherCartels,
  FIXED_OTHER_CARTELS,
};
