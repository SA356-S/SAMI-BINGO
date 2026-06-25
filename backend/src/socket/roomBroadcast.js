'use strict';

/**
 * Compact fingerprint for room-wide Socket.IO payload deduplication.
 * Excludes serverTime when requested so periodic ticks skip redundant emits.
 *
 * @param {object} payload
 * @param {{ ignoreServerTime?: boolean }} [opts]
 */
function roomBroadcastFingerprint(payload, opts = {}) {
  const ignoreServerTime = opts.ignoreServerTime === true;
  let takenKey = '';
  if (Array.isArray(payload.takenCartels)) {
    takenKey = payload.takenCartels.join(',');
  }

  const parts = [
    payload.gameId ?? '',
    payload.status ?? '',
    payload.gameStatus ?? '',
    payload.lobbyPhase ?? payload.phase ?? '',
    payload.countdownSeconds ?? '',
    payload.countdownEndsAt ?? '',
    ignoreServerTime ? '' : String(payload.serverTime ?? ''),
    takenKey,
    payload.playersCount ?? '',
    payload.selectionLocked === true ? '1' : '0',
    payload.gameInProgress === true ? '1' : '0',
    payload.latestBall ?? '',
    payload.calledCount ?? '',
    payload.sequence ?? '',
    payload.totalCards ?? '',
    payload.derash ?? '',
    payload.pot ?? '',
  ];

  if (Array.isArray(payload.players)) {
    parts.push(
      payload.players
        .map((p) => `${p.userId ?? p.socketId}:${p.cartelCount}:${p.status ?? ''}`)
        .join(';')
    );
  }

  return parts.join('|');
}

/**
 * Emit to a Socket.IO room only when the payload fingerprint changed.
 * @returns {boolean} true when an emit occurred
 */
function emitRoomIfChanged(io, roomName, eventName, payload, cache, cacheKey, opts = {}) {
  if (!io || !roomName || !eventName || !cache) return false;
  const fp = roomBroadcastFingerprint(payload, opts);
  if (cache[cacheKey] === fp) return false;
  cache[cacheKey] = fp;
  io.to(roomName).emit(eventName, payload);
  return true;
}

function clearRoomBroadcastCache(cache) {
  if (!cache) return;
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
}

module.exports = {
  roomBroadcastFingerprint,
  emitRoomIfChanged,
  clearRoomBroadcastCache,
};
