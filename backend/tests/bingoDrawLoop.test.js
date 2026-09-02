const { test } = require('node:test');
const assert = require('node:assert/strict');

const bingoBall = require('../src/utils/bingoBall');
const { GameSession } = require('../src/socket/gameManager');

function mockIo(emits) {
  return {
    to() {
      return {
        emit(event, payload) {
          emits.push({ event, payload });
        },
      };
    },
    emit() {},
  };
}

test('drawNextBall never repeats a number in one round', () => {
  const called = new Set();
  const drawn = [];
  for (let i = 0; i < 75; i += 1) {
    const next = bingoBall.drawNextBall(called);
    assert.notEqual(next, null);
    assert.equal(called.has(next), false);
    called.add(next);
    drawn.push(next);
  }
  assert.equal(bingoBall.drawNextBall(called), null);
  assert.equal(new Set(drawn).size, 75);
});

test('callNextBall records the number before broadcasting and rejects duplicates', () => {
  const session = new GameSession('TEST-DRAW-1');
  session.status = 'calling';
  session._drawLoopToken = 1;
  const emits = [];
  const io = mockIo(emits);

  for (let i = 0; i < 75; i += 1) {
    session.callNextBall(io, 1);
  }

  const numbers = session.calledNumbers;
  assert.equal(numbers.length, 75);
  assert.equal(new Set(numbers).size, 75);

  const liveDraws = emits.filter((e) => e.event === 'newNumber');
  assert.equal(liveDraws.length, 75);
  const liveNums = liveDraws.map((e) => e.payload.number);
  assert.deepEqual(liveNums, numbers);

  session.stopCalling();
  session.clearResetTimer();
});

test('stale draw-loop tokens cannot emit a second loop', () => {
  const session = new GameSession('TEST-DRAW-2');
  session.status = 'calling';
  session._drawLoopToken = 2;
  const emits = [];
  const io = mockIo(emits);

  session.callNextBall(io, 1);
  assert.equal(session.calledNumbers.length, 0);
  assert.equal(emits.filter((e) => e.event === 'newNumber').length, 0);

  session.callNextBall(io, 2);
  session.clearResetTimer();
  session.stopCalling();
  assert.equal(session.calledNumbers.length, 1);
});

test('in-flight draw does not queue a catch-up second ball', () => {
  const session = new GameSession('TEST-DRAW-3');
  session.status = 'calling';
  session._drawLoopToken = 1;
  session._ballCallInFlight = true;
  const emits = [];
  session.callNextBall(mockIo(emits), 1);
  assert.equal(session.calledNumbers.length, 0);
  assert.equal(emits.length, 0);
  assert.equal(session._ballCallPending, false);
});
