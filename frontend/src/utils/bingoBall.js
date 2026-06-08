import { BINGO_COLUMNS } from './bingoCard';

/** Letter for a called number (75-ball). */
export function getBingoLetter(num) {
  const n = Number(num);
  for (const { letter, min, max } of BINGO_COLUMNS) {
    if (n >= min && n <= max) return letter;
  }
  return '?';
}

/** Display label e.g. "O-71" */
export function formatBallCall(num) {
  return `${getBingoLetter(num)}-${num}`;
}

/** Pick a random uncalled ball from 1–75 */
export function drawNextBall(calledSet) {
  const remaining = [];
  for (let n = 1; n <= 75; n += 1) {
    if (!calledSet.has(n)) remaining.push(n);
  }
  if (remaining.length === 0) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}
