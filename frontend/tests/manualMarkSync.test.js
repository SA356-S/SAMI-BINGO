import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBingoCard } from '../src/utils/bingoCard.js';
import { toggleManualMarkSynced } from '../src/utils/bingoWin.js';

function numbersOnGrid(grid) {
  const nums = new Map();
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const n = grid[row][col];
      if (n != null) nums.set(n, `${row}-${col}`);
    }
  }
  return nums;
}

function findSharedPair() {
  for (let a = 1; a <= 400; a += 1) {
    const gridA = generateBingoCard(a).grid;
    const mapA = numbersOnGrid(gridA);
    for (let b = a + 1; b <= 400; b += 1) {
      const gridB = generateBingoCard(b).grid;
      const mapB = numbersOnGrid(gridB);
      for (const [n, keyA] of mapA) {
        if (mapB.has(n)) {
          return {
            a,
            b,
            number: n,
            keyA,
            keyB: mapB.get(n),
            gridA,
            gridB,
          };
        }
      }
    }
  }
  throw new Error('No shared number found');
}

function findUniqueOnA(pair) {
  const mapA = numbersOnGrid(pair.gridA);
  const mapB = numbersOnGrid(pair.gridB);
  for (const [n, keyA] of mapA) {
    if (!mapB.has(n)) {
      return { number: n, keyA };
    }
  }
  throw new Error('No unique number on A');
}

const pair = findSharedPair();
const uniqueA = findUniqueOnA(pair);
const [rowA, colA] = pair.keyA.split('-').map(Number);
const [rowB, colB] = pair.keyB.split('-').map(Number);
const [uRow, uCol] = uniqueA.keyA.split('-').map(Number);
const grids = { [pair.a]: pair.gridA, [pair.b]: pair.gridB };

test('selecting a called number on one cartela marks the same number on the other', () => {
  const next = toggleManualMarkSynced({
    tappedCartelId: pair.a,
    row: rowA,
    col: colA,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set([pair.number]),
    gridsByCartel: grids,
    existingMarks: {},
  });

  assert.equal(next[pair.a].has(pair.keyA), true);
  assert.equal(next[pair.b].has(pair.keyB), true);
});

test('selecting from the other cartela first also syncs both ways', () => {
  const next = toggleManualMarkSynced({
    tappedCartelId: pair.b,
    row: rowB,
    col: colB,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set([pair.number]),
    gridsByCartel: grids,
    existingMarks: {},
  });

  assert.equal(next[pair.a].has(pair.keyA), true);
  assert.equal(next[pair.b].has(pair.keyB), true);
});

test('a number on only one cartela marks only that cartela', () => {
  const next = toggleManualMarkSynced({
    tappedCartelId: pair.a,
    row: uRow,
    col: uCol,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set([uniqueA.number]),
    gridsByCartel: grids,
    existingMarks: {},
  });

  assert.equal(next[pair.a].has(uniqueA.keyA), true);
  assert.equal(next[pair.b]?.has(pair.keyB) ?? false, false);
  assert.equal([...next[pair.b] ?? []].length, 0);
});

test('uncalled numbers are not synced to the other cartela', () => {
  const next = toggleManualMarkSynced({
    tappedCartelId: pair.a,
    row: rowA,
    col: colA,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set(),
    gridsByCartel: grids,
    existingMarks: {},
  });

  assert.equal(next[pair.a].has(pair.keyA), true);
  assert.equal(next[pair.b], undefined);
});

test('unselecting a synced called number clears both cartelas', () => {
  const selected = toggleManualMarkSynced({
    tappedCartelId: pair.a,
    row: rowA,
    col: colA,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set([pair.number]),
    gridsByCartel: grids,
    existingMarks: {},
  });
  const next = toggleManualMarkSynced({
    tappedCartelId: pair.b,
    row: rowB,
    col: colB,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set([pair.number]),
    gridsByCartel: grids,
    existingMarks: selected,
  });

  assert.equal(next[pair.a].has(pair.keyA), false);
  assert.equal(next[pair.b].has(pair.keyB), false);
});

test('FREE center is not toggled', () => {
  const next = toggleManualMarkSynced({
    tappedCartelId: pair.a,
    row: 2,
    col: 2,
    cartelIds: [pair.a, pair.b],
    calledNumbers: new Set([pair.number]),
    gridsByCartel: grids,
    existingMarks: { [pair.a]: new Set(['0-0']) },
  });

  assert.equal(next[pair.a].has('0-0'), true);
  assert.equal(next[pair.a].has('2-2'), false);
});
