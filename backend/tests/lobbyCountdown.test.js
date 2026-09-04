const { test } = require('node:test');
const assert = require('node:assert/strict');

const { GameSession } = require('../src/socket/gameManager');
const { LOBBY_SELECTION_LOCK_REMAINING_SEC, LOBBY_PHASE } = require('../src/config/constants');

function mockIo() {
  const emits = [];
  return {
    sockets: { sockets: new Map() },
    to() {
      return {
        emit(event, payload) {
          emits.push({ event, payload });
        },
      };
    },
    emit(event, payload) {
      emits.push({ event, payload, broadcast: true });
    },
    emits,
  };
}

function waitingSession(gameId = 'LOBBY-COUNTDOWN-1') {
  const session = new GameSession(gameId);
  session.status = 'waiting';
  session.lobbyPhase = LOBBY_PHASE.COUNTDOWN_RUNNING;
  session.ensureLobbyCountdownRunning();
  return session;
}

function setRemainingSeconds(session, seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  if (sec === 0) {
    session.lobbyCountdownEndsAt = Date.now() - 50;
    return;
  }
  session.lobbyCountdownEndsAt = Date.now() + (sec - 0.2) * 1000;
}

test('selection is allowed with more than 3 seconds remaining', () => {
  const session = waitingSession();
  setRemainingSeconds(session, 6);
  assert.equal(session.getLobbyCountdownRemaining() >= 5, true);
  assert.equal(session.isLobbySelectionFrozen(), false);
  assert.equal(session.isSelectionLocked(), false);

  const result = session.assignCartels('sock-1', [7], 'Player', '10001');
  assert.equal(result.ok, true);
  assert.deepEqual(session.getCartelsForUser('10001'), [7]);
});

test('select is rejected at exactly 3 seconds remaining', () => {
  const session = waitingSession();
  setRemainingSeconds(session, LOBBY_SELECTION_LOCK_REMAINING_SEC);
  assert.equal(session.getLobbyCountdownRemaining(), 3);
  assert.equal(session.isLobbySelectionFrozen(), true);
  assert.equal(session.isSelectionLocked(), true);

  const result = session.assignCartels('sock-1', [12], 'Player', '10001');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'selection_closed');
  assert.equal(result.selectionLocked, true);
  assert.deepEqual(session.getCartelsForUser('10001'), []);
});

test('select is rejected at 2, 1, and 0 seconds remaining', () => {
  for (const remaining of [2, 1, 0]) {
    const session = waitingSession(`LOCK-${remaining}`);
    setRemainingSeconds(session, remaining);
    assert.equal(session.getLobbyCountdownRemaining(), remaining);
    assert.equal(session.isLobbySelectionFrozen(), true);

    const result = session.assignCartels('sock-1', [8], 'Player', '10002');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'selection_closed');
  }
});

test('release is rejected at 3 seconds remaining', () => {
  const session = waitingSession();
  setRemainingSeconds(session, 10);
  const seated = session.assignCartels('sock-1', [21, 22], 'Player', '10003');
  assert.equal(seated.ok, true);

  setRemainingSeconds(session, 3);
  const released = session.assignCartels('sock-1', [], 'Player', '10003');
  assert.equal(released.ok, false);
  assert.equal(released.error, 'selection_closed');
  assert.deepEqual(session.getCartelsForUser('10003'), [21, 22]);
});

test('identical selection is allowed during the final 3 seconds', () => {
  const session = waitingSession();
  setRemainingSeconds(session, 10);
  assert.equal(session.assignCartels('sock-1', [31], 'Player', '10004').ok, true);

  setRemainingSeconds(session, 3);
  const again = session.assignCartels('sock-1', [31], 'Player', '10004');
  assert.equal(again.ok, true);
  assert.deepEqual(session.getCartelsForUser('10004'), [31]);
});

test('robots can still be seated during the human 3-second freeze', () => {
  const session = waitingSession();
  setRemainingSeconds(session, 3);
  const result = session.assignCartels('sock-robot', [40], 'Robot', 'robot:test-1');
  assert.equal(result.ok, true);
  assert.deepEqual(session.getCartelsForUser('robot:test-1'), [40]);
});

test('countdown remaining 0 restarts instead of freezing when too few cartelas', () => {
  const session = waitingSession();
  const io = mockIo();
  setRemainingSeconds(session, 0);
  assert.equal(session.getLobbyCountdownRemaining(), 0);
  assert.equal(session.status, 'waiting');

  const started = session.handleLobbyCountdownExpired(io);
  assert.equal(started, false);
  assert.equal(session.status, 'waiting');
  assert.equal(session.getLobbyCountdownRemaining() > 0, true);
  assert.equal(session.isLobbySelectionFrozen(), false);
});

test('duplicate expiry while still waiting at 0 never leaves remaining at 0', () => {
  const session = waitingSession();
  const io = mockIo();
  setRemainingSeconds(session, 0);
  session.handleLobbyCountdownExpired(io);
  setRemainingSeconds(session, 0);
  session.handleLobbyCountdownExpired(io);
  session.handleLobbyCountdownExpired(io);

  assert.equal(session.status, 'waiting');
  assert.equal(session.getLobbyCountdownRemaining() > 0, true);
});

test('tryStartLobbyGame is idempotent after the round has already started', () => {
  const session = waitingSession();
  const io = mockIo();
  session.status = 'calling';
  session.lobbyPhase = LOBBY_PHASE.GAME_STARTED;

  const first = session.tryStartLobbyGame(io, { fromCountdownExpiry: true });
  const second = session.tryStartLobbyGame(io, { fromCountdownExpiry: true });
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(session.lobbyPhase, LOBBY_PHASE.GAME_STARTED);

  const startedEvents = io.emits.filter((row) => row.event === 'game:started');
  assert.equal(startedEvents.length >= 2, true);
});

test('lobby sync payload reports selectionLocked at 3 seconds and Main Game after start', () => {
  const session = waitingSession();
  setRemainingSeconds(session, 3);
  const frozen = session.toLobbySyncPayload('10005');
  assert.equal(frozen.selectionLocked, true);
  assert.equal(frozen.gameInProgress, false);
  assert.equal(frozen.countdownSeconds, 3);

  session.status = 'calling';
  session.lobbyPhase = LOBBY_PHASE.GAME_STARTED;
  const started = session.toLobbySyncPayload('10005');
  assert.equal(started.selectionLocked, true);
  assert.equal(started.gameInProgress, true);
  assert.equal(started.lobbyPhase, LOBBY_PHASE.GAME_STARTED);
  assert.equal(started.gameStatus, 'RUNNING');
});

test('watchingOnly is not set during the 3-second freeze of an open lobby', () => {
  const session = waitingSession();
  setRemainingSeconds(session, 3);
  const payload = session.toCardSelectionPayload({ main: 0, play: 0 }, '10006');
  assert.equal(payload.selectionLocked, true);
  assert.equal(payload.watchingOnly, false);
  assert.equal(payload.gameInProgress, false);
});
