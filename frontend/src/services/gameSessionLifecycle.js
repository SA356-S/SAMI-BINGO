import { resetBallSoundQueue } from '../audio/gameSounds';
import {
  blockMainGameAutoEntry,
  isMainGameAutoEntryBlocked,
  releaseMainGameAutoEntry,
} from './sessionLifecycleFlags';
import {
  resetLobbySessionState,
  scheduleLobbyResyncAfterSessionClear,
} from './lobbySession';

/** @type {(() => void) | null} */
let mainGameSessionReset = null;

/**
 * MainGame registers its local React/ref cleanup once on mount.
 * @param {() => void} handler
 */
export function registerMainGameSessionReset(handler) {
  mainGameSessionReset = handler;
  return () => {
    if (mainGameSessionReset === handler) {
      mainGameSessionReset = null;
    }
  };
}

/**
 * Single source of truth for end-of-round cleanup.
 * Resets lobby, in-game UI state, audio queue, and blocks stale auto re-entry.
 */
export function clearGameSession() {
  blockMainGameAutoEntry();
  mainGameSessionReset?.();
  resetLobbySessionState();
  resetBallSoundQueue();
  scheduleLobbyResyncAfterSessionClear();
}

export { isMainGameAutoEntryBlocked, releaseMainGameAutoEntry };
