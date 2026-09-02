const { test } = require('node:test');
const assert = require('node:assert/strict');

const bingoBall = require('../src/utils/bingoBall');
const { generateBingoCard } = require('../src/utils/bingoCard');
const { validateBingoClaim } = require('../src/utils/bingoWin');
const { GameSession } = require('../src/socket/gameManager');

const CARTEL_ID = 1;

function winningLineNumbers(cartelId = CARTEL_ID) {
  const { grid } = generateBingoCard(cartelId);
  // Middle row includes the free center — 4 called numbers complete the pattern.
  return grid[2].filter((n) => n != null);
}

function incompleteLineNumbers(cartelId = CARTEL_ID) {
  return winningLineNumbers(cartelId).slice(0, 2);
}

function mockIo() {
  const emits = [];
  const io = {
    to() {
      return {
        emit(event, payload) {
          emits.push({ event, payload });
        },
      };
    },
    emit() {},
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
  };
  return { io, emits };
}

async function withQueuedDraws(queue, fn) {
  const original = bingoBall.drawNextBall;
  bingoBall.drawNextBall = (calledSet) => {
    const next = queue.find((n) => !calledSet.has(n));
    return next ?? original(calledSet);
  };
  try {
    return await fn();
  } finally {
    bingoBall.drawNextBall = original;
  }
}

async function flushAsyncTurns() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function seatHuman(session, cartelId = CARTEL_ID) {
  const result = session.assignCartels('sock-human', [cartelId], 'TestPlayer', '10001');
  assert.equal(result.ok, true);
  const player = session.players.get('sock-human');
  player.automatic = true;
  return player;
}

function prepareCallingSession(gameId) {
  const session = new GameSession(gameId);
  seatHuman(session);
  session.status = 'calling';
  session._drawLoopToken = 1;
  session.stakesCharged = true;
  return session;
}

test('validateBingoClaim is true when the middle row is fully called', () => {
  const numbers = winningLineNumbers();
  assert.equal(numbers.length, 4);
  assert.equal(validateBingoClaim(CARTEL_ID, numbers, [], true), true);
  assert.equal(validateBingoClaim(CARTEL_ID, numbers.slice(0, 2), [], true), false);
});

test('latest ball that completes a winning pattern triggers declareWinner immediately', async () => {
  const numbers = winningLineNumbers();
  const session = prepareCallingSession('WIN-DETECT-1');
  const { io, emits } = mockIo();

  await withQueuedDraws(numbers, async () => {
    for (let i = 0; i < numbers.length; i += 1) {
      session.callNextBall(io, 1);
      await flushAsyncTurns();
      if (session.winner || session._winnerLocked) break;
    }
  });

  await flushAsyncTurns();

  assert.equal(validateBingoClaim(CARTEL_ID, session.calledNumbers, [], true), true);
  assert.ok(session.winner, 'winner must be set when the pattern completes');
  assert.equal(session._winnerLocked, true);
  assert.equal(Number(session.winner.cartelId ?? session.winner.primaryCartelId), CARTEL_ID);

  const winnerEvents = emits.filter((e) => e.event === 'game:winner');
  assert.ok(winnerEvents.length >= 1, 'existing game:winner announcement must be emitted');
  assert.equal(Number(winnerEvents[0].payload.primaryCartelId), CARTEL_ID);

  const liveDraws = emits.filter((e) => e.event === 'newNumber');
  assert.equal(liveDraws.length, numbers.length);
  assert.equal(session.calledNumbers.length, numbers.length);

  const calledAfterWin = session.calledNumbers.length;
  session.callNextBall(io, 1);
  await flushAsyncTurns();
  assert.equal(session.calledNumbers.length, calledAfterWin, 'no extra balls after winner');

  session.clearResetTimer();
  session.stopCalling();
});

test('non-winning called numbers do not end the round', async () => {
  const numbers = incompleteLineNumbers();
  const session = prepareCallingSession('WIN-DETECT-2');
  const { io, emits } = mockIo();

  await withQueuedDraws(numbers, async () => {
    for (let i = 0; i < numbers.length; i += 1) {
      session.callNextBall(io, 1);
      await flushAsyncTurns();
    }
  });

  assert.equal(validateBingoClaim(CARTEL_ID, session.calledNumbers, [], true), false);
  assert.equal(session.winner, null);
  assert.equal(session._winnerLocked, false);
  assert.equal(session.status, 'calling');
  assert.equal(emits.filter((e) => e.event === 'game:winner').length, 0);
  assert.equal(emits.filter((e) => e.event === 'newNumber').length, numbers.length);

  session.clearResetTimer();
  session.stopCalling();
});
