/** Tracks server-side robot "virtual socket" membership in the live game room. */
const virtualRoomMembers = new Map();

function trackRobotRoomMember(session, rt) {
  if (!session?.roomName || !rt?.pseudoSocketId) return;
  virtualRoomMembers.set(rt.pseudoSocketId, {
    roomName: session.roomName,
    robotId: rt.robotId,
    displayName: rt.displayName,
  });
  if (!session._robotSocketIds) {
    session._robotSocketIds = new Set();
  }
  session._robotSocketIds.add(rt.pseudoSocketId);
}

function untrackRobotRoomMember(session, rt) {
  if (rt?.pseudoSocketId) {
    virtualRoomMembers.delete(rt.pseudoSocketId);
    session?._robotSocketIds?.delete(rt.pseudoSocketId);
  }
}

function isRobotSeatedInSession(session, rt) {
  const player = session?.players?.get(rt.pseudoSocketId);
  return Boolean(player?.cartelIds?.length);
}

function listRobotsInRoom(roomName) {
  const out = [];
  for (const entry of virtualRoomMembers.values()) {
    if (entry.roomName === roomName) out.push(entry);
  }
  return out;
}

module.exports = {
  virtualRoomMembers,
  trackRobotRoomMember,
  untrackRobotRoomMember,
  isRobotSeatedInSession,
  listRobotsInRoom,
};
