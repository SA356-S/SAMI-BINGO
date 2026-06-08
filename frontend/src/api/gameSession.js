import { getSocket, SOCKET_URL } from './socket';
import {
  getPlayerUserId,
  getTelegramIdentityPayload,
} from './playerIdentity';

/** @deprecated Use getPlayerUserId() */
function getPlayerId() {
  return getPlayerUserId();
}
const ACK_TIMEOUT_MS = 12000;

/** Serialize cartel manual marks for socket transport */
export function serializeManualMarks(marksByCartel = {}) {
  const out = {};
  for (const [cartelId, marks] of Object.entries(marksByCartel)) {
    if (marks instanceof Set) {
      out[cartelId] = [...marks];
    } else if (Array.isArray(marks)) {
      out[cartelId] = marks;
    }
  }
  return out;
}

/** Restore manual marks from server payload */
export function deserializeManualMarks(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [cartelId, keys] of Object.entries(raw)) {
    out[Number(cartelId)] = new Set(
      Array.isArray(keys) ? keys.map(String) : []
    );
  }
  return out;
}

function emitWithAck(event, payload = {}) {
  return new Promise((resolve) => {
    const socket = getSocket();
    let settled = false;

    const finish = (ack) => {
      if (settled) return;
      settled = true;
      resolve(ack ?? { ok: false });
    };

    const timer = setTimeout(() => {
      console.warn(`[play10] socket ack timeout (${ACK_TIMEOUT_MS}ms):`, event, {
        socketUrl: SOCKET_URL,
        connected: socket.connected,
      });
      finish({ ok: false, error: 'timeout' });
    }, ACK_TIMEOUT_MS);

    const onAck = (ack) => {
      clearTimeout(timer);
      finish(ack);
    };

    const emitNow = () => {
      socket.emit(event, payload, onAck);
    };

    if (socket.connected) {
      emitNow();
      return;
    }

    console.log('[play10] socket not connected, connecting to', SOCKET_URL);

    const onConnect = () => {
      cleanupListeners();
      emitNow();
    };

    const onConnectError = (err) => {
      console.warn('[play10] socket connect_error', err?.message ?? err);
      cleanupListeners();
      clearTimeout(timer);
      finish({ ok: false, error: err?.message ?? 'connect_error' });
    };

    const cleanupListeners = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.connect();
  });
}

/** Ask backend whether this user should rejoin main game or open card selection */
export async function fetchPlayerGameStatus(userId = getPlayerId()) {
  const id = userId || getPlayerUserId();
  if (!id) {
    console.error('[play10] game:player-status skipped — no Telegram user');
    return { ok: false, error: 'telegram_auth_required' };
  }

  console.log('[play10] game:player-status request', { userId: id, socketUrl: SOCKET_URL });
  const ack = await emitWithAck('game:player-status', {
    userId: id,
    playerName: id,
    telegramId: id,
    ...getTelegramIdentityPayload(),
  });
  console.log('[play10] game:player-status response', ack);
  return ack;
}

/** Rejoin an in-progress game session */
export async function rejoinActiveGame(userId = getPlayerUserId(), gameId) {
  return emitWithAck('game:rejoin', {
    userId,
    playerName: userId,
    gameId,
  });
}

/** Join as spectator when the round is already in progress */
export async function joinAsWatcher(userId = getPlayerUserId(), gameId) {
  return emitWithAck('game:watch', {
    userId,
    playerName: userId,
    telegramId: userId,
    gameId,
    ...getTelegramIdentityPayload(),
  });
}

export { getPlayerUserId };
