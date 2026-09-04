import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLobbySelectionFrozen,
  LOBBY_SELECTION_LOCK_REMAINING_SEC,
} from '../src/utils/lobbySelectionLock.js';
import { isLobbyGameStarted } from '../src/utils/mainGameEntry.js';

test('frontend freeze helper allows selection before the final 3 seconds', () => {
  assert.equal(isLobbySelectionFrozen(4), false);
  assert.equal(isLobbySelectionFrozen(10), false);
});

test('frontend freeze helper locks at 3, 2, 1, and 0 seconds', () => {
  for (const remaining of [3, 2, 1, 0]) {
    assert.equal(isLobbySelectionFrozen(remaining), true);
  }
  assert.equal(LOBBY_SELECTION_LOCK_REMAINING_SEC, 3);
});

test('frontend freeze helper locks when the server already closed selection', () => {
  assert.equal(isLobbySelectionFrozen(20, { selectionLocked: true }), true);
  assert.equal(isLobbySelectionFrozen(20, { gameInProgress: true }), true);
});

test('GAME_STARTED / running lobby is treated as Main Game', () => {
  assert.equal(isLobbyGameStarted({ lobbyPhase: 'GAME_STARTED' }), true);
  assert.equal(isLobbyGameStarted({ gameInProgress: true }), true);
  assert.equal(isLobbyGameStarted({ gameStatus: 'RUNNING' }), true);
  assert.equal(
    isLobbyGameStarted({
      lobbyPhase: 'COUNTDOWN_RUNNING',
      gameInProgress: false,
      gameStatus: 'WAITING',
    }),
    false
  );
});
