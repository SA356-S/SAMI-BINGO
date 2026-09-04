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

function middleRowMarkKeys() {
  return ['2-0', '2-1', '2-3', '2-4'];
}

test('completed valid pattern is Bingo after the last called number is processed', async () => {
  const numbers = winningLineNumbers();
  const session = prepareCallingSession('WIN-DETECT-3');
  const { io } = mockIo();

  await withQueuedDraws(numbers, async () => {
    for (let i = 0; i < numbers.length; i += 1) {
      session.callNextBall(io, 1);
      await flushAsyncTurns();
      if (session.winner) break;
    }
  });

  assert.ok(session.calledNumbers.includes(numbers[numbers.length - 1]));
  assert.equal(validateBingoClaim(CARTEL_ID, session.calledNumbers, [], true), true);
  assert.ok(session.winner);
  assert.notEqual(session.winner?.error, 'No Bingo');
  session.clearResetTimer();
  session.stopCalling();
});

test('valid incomplete pattern is not Bingo', () => {
  const numbers = incompleteLineNumbers();
  assert.equal(validateBingoClaim(CARTEL_ID, numbers, [], true), false);
  assert.equal(validateBingoClaim(CARTEL_ID, [], [], true), false);
});

test('multiple cartelas detect the winning cartela only', async () => {
  const secondCartel = 40;
  const session = new GameSession('WIN-DETECT-MULTI');
  const assigned = session.assignCartels(
    'sock-human',
    [CARTEL_ID, secondCartel],
    'TestPlayer',
    '10001'
  );
  assert.equal(assigned.ok, true);
  session.players.get('sock-human').automatic = true;
  session.status = 'calling';
  session._drawLoopToken = 1;
  session.stakesCharged = true;

  const numbers = winningLineNumbers(CARTEL_ID);
  const { io } = mockIo();

  await withQueuedDraws(numbers, async () => {
    for (let i = 0; i < numbers.length; i += 1) {
      session.callNextBall(io, 1);
      await flushAsyncTurns();
      if (session.winner) break;
    }
  });

  assert.equal(validateBingoClaim(CARTEL_ID, session.calledNumbers, [], true), true);
  assert.ok(session.winner);
  assert.equal(Number(session.winner.cartelId ?? session.winner.primaryCartelId), CARTEL_ID);
  session.clearResetTimer();
  session.stopCalling();
});

test('stale empty manual marks do not block Bingo once the completed line is marked', async () => {
  const numbers = winningLineNumbers();
  const session = prepareCallingSession('WIN-DETECT-MARKS');
  const player = session.players.get('sock-human');
  player.automatic = false;
  player.manualMarks = {};
  const { io } = mockIo();

  await withQueuedDraws(numbers, async () => {
    for (let i = 0; i < numbers.length; i += 1) {
      session.callNextBall(io, 1);
      await flushAsyncTurns();
    }
  });

  assert.equal(
    validateBingoClaim(CARTEL_ID, session.calledNumbers, [], false),
    false
  );
  assert.equal(session.winner, null);

  session.updatePlayerMarks('10001', { [CARTEL_ID]: middleRowMarkKeys() }, false);
  assert.equal(
    validateBingoClaim(
      CARTEL_ID,
      session.calledNumbers,
      session.getPlayerCartelMarks(player, CARTEL_ID),
      false
    ),
    true
  );

  session.tryDeclareHumanBingoAfterBall(io);
  await flushAsyncTurns();

  assert.ok(session.winner, 'late-arriving marks of a completed line must still be Bingo');
  assert.notEqual(session.winner?.error, 'No Bingo');
  session.clearResetTimer();
  session.stopCalling();
});

test('completed pattern remains Bingo when the pre-win interceptor would return No Bingo', async () => {
  const robotEngine = require('../src/services/robotEngine');
  const original = robotEngine.runPreWinInterceptorForHumanClaim;
  robotEngine.runPreWinInterceptorForHumanClaim = async () => ({
    outcome: 'block_human',
    payload: null,
  });

  try {
    const numbers = winningLineNumbers();
    const session = prepareCallingSession('WIN-DETECT-GATE');
    const { io } = mockIo();

    await withQueuedDraws(numbers, async () => {
      for (let i = 0; i < numbers.length; i += 1) {
        session.callNextBall(io, 1);
        await flushAsyncTurns();
        if (session.winner) break;
      }
    });

    assert.equal(validateBingoClaim(CARTEL_ID, session.calledNumbers, [], true), true);
    assert.ok(
      session.winner,
      'validated Bingo must be declared even if the interceptor would block_human'
    );
    assert.notEqual(session.winner?.error, 'No Bingo');
    session.clearResetTimer();
    session.stopCalling();
  } finally {
    robotEngine.runPreWinInterceptorForHumanClaim = original;
  }
});

test('validateBingoClaim accepts Set or array of called numbers including the last ball', () => {
  const numbers = winningLineNumbers();
  assert.equal(validateBingoClaim(CARTEL_ID, numbers, [], true), true);
  assert.equal(validateBingoClaim(CARTEL_ID, new Set(numbers), [], true), true);
  assert.equal(
    validateBingoClaim(CARTEL_ID, numbers.map(String), [], true),
    true
  );
});

test('playerOwnsCartel is not fooled by string vs number cartel ids', () => {
  const session = prepareCallingSession('WIN-DETECT-OWN');
  const player = session.players.get('sock-human');
  player.cartelIds = ['1'];
  assert.equal(session.playerOwnsCartel(player, 1), true);
  assert.equal(session.playerOwnsCartel(player, '1'), true);
  assert.equal(session.playerOwnsCartel(player, 2), false);
  session.stopCalling();
});
