const { mongoose } = require('../config/db');

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function formatUsername(userId) {
  const id = String(userId || 'player');
  return id.startsWith('@') ? id : `@${id.toUpperCase()}`;
}

function isRobotUserId(userId) {
  return String(userId || '').startsWith('robot:');
}

function isGenericPlayerName(name, userId = '') {
  const value = String(name || '').trim();
  const id = String(userId || '').trim();
  if (!value) return true;
  if (/^player(\s+\d+)?$/i.test(value)) return true;
  if (/^\d{5,}$/.test(value)) return true;
  if (/^user\s+\d+$/i.test(value)) return true;
  if (/^robot$/i.test(value)) return true;
  if (/^robot[_:\-\s]/i.test(value)) return true;
  if (/^@?robot/i.test(value) && isRobotUserId(id)) return true;

  const bare = value.replace(/^@/, '');
  const bareId = id.replace(/^robot:/, '');
  if (bare.toLowerCase() === id.toLowerCase()) return true;
  if (bare.toLowerCase() === bareId.toLowerCase()) return true;
  if (value === formatUsername(id)) return true;
  if (value === formatUsername(bareId)) return true;
  return false;
}

function formatAnnouncementName(name, userId = '') {
  const picked = String(name || '').trim();
  if (!picked || isGenericPlayerName(picked, userId)) return null;
  if (picked.startsWith('@')) return picked;
  if (/^[a-zA-Z0-9_]{2,32}$/.test(picked)) return `@${picked}`;
  return picked;
}

function sanitizeHumanDisplayName(name, userId) {
  const value = String(name || '').trim();
  const id = String(userId || '').trim();
  if (!value) return 'Player';
  if (/^\d+$/.test(value)) return 'Player';
  if (/^user\s+\d+$/i.test(value)) return 'Player';
  if (value.replace(/^@/, '') === id) return 'Player';
  return value;
}

function pickDisplayName(userId, storedName, resolvedNames) {
  const id = userId ? String(userId) : '';
  const resolved = id ? resolvedNames?.get(id) : null;
  if (resolved) return resolved;

  const stored = String(storedName || '').trim();
  if (stored && !isGenericPlayerName(stored, id)) return stored;

  return 'Player';
}

function resolveRobotNameSync(userId) {
  const id = String(userId || '');
  if (!isRobotUserId(id)) return null;

  try {
    const { listActiveRobotsForEngineSync } = require('./robotManagementService');
    const match = listActiveRobotsForEngineSync().find((robot) => robot.robotId === id);
    if (match?.name && !isGenericPlayerName(match.name, id)) {
      return match.name;
    }
  } catch {
    /* optional */
  }

  return null;
}

async function resolveDisplayNamesForUserIds(userIds) {
  const unique = [...new Set(userIds.map((id) => String(id)).filter(Boolean))];
  const names = new Map();
  if (unique.length === 0) return names;

  const robotIds = unique.filter(isRobotUserId);
  const humanIds = unique.filter((id) => !isRobotUserId(id));

  if (robotIds.length > 0) {
    try {
      const { listRobots } = require('./robotManagementService');
      const robots = await listRobots();
      const byRobotId = new Map(robots.map((r) => [r.robotId, r.name]));

      let profileByRobotId = new Map();
      if (isDbReady()) {
        const { RobotProfileModel } = require('../models/RobotProfile');
        const profiles = await RobotProfileModel.find({
          robotId: { $in: robotIds },
        }).lean();
        profileByRobotId = new Map(profiles.map((row) => [row.robotId, row]));
      }

      for (const id of robotIds) {
        const customName = String(byRobotId.get(id) || '').trim();
        if (customName && !isGenericPlayerName(customName, id)) {
          names.set(id, customName);
          continue;
        }

        const profile = profileByRobotId.get(id);
        const fallbackName = String(
          profile?.displayName || profile?.username || ''
        ).trim();
        if (fallbackName && !isGenericPlayerName(fallbackName, id)) {
          names.set(id, fallbackName);
        }
      }
    } catch (err) {
      console.warn('[displayName] robot resolve failed', err?.message);
    }
  }

  if (humanIds.length > 0) {
    try {
      const { resolveDisplayUsername } = require('./profileService');
      const numericIds = humanIds.filter((id) => /^\d+$/.test(id));
      let telegramRows = [];
      let profiles = [];

      if (isDbReady()) {
        const { TelegramUserModel } = require('../models/TelegramUser');
        const { UserProfileModel } = require('../models/UserProfile');
        [telegramRows, profiles] = await Promise.all([
          numericIds.length
            ? TelegramUserModel.find({
                telegramId: { $in: numericIds.map(Number) },
              }).lean()
            : [],
          UserProfileModel.find({ userId: { $in: humanIds } }).lean(),
        ]);
      }

      const telegramById = new Map(
        telegramRows.map((row) => [String(row.telegramId), row])
      );
      const profileById = new Map(profiles.map((row) => [row.userId, row]));

      for (const id of humanIds) {
        const resolved = resolveDisplayUsername(
          id,
          {},
          telegramById.get(id) ?? null,
          profileById.get(id) ?? null
        );
        names.set(id, sanitizeHumanDisplayName(resolved, id));
      }
    } catch (err) {
      console.warn('[displayName] human resolve failed', err?.message);
    }
  }

  return names;
}

function findUserIdForCartel(session, cartelId) {
  const id = Number(cartelId);
  if (!session || !Number.isInteger(id)) return null;

  for (const player of session.allSeatedPlayers()) {
    if (player.cartelIds?.includes(id)) {
      return player.userId ? String(player.userId) : String(player.socketId);
    }
  }
  return null;
}

function collectWinnerUserIds(session, payload) {
  const ids = new Set();
  const winners = Array.isArray(payload?.winners) ? payload.winners : [];

  for (const winner of winners) {
    if (winner?.userId) ids.add(String(winner.userId));
    else {
      const userId = findUserIdForCartel(session, winner?.cartelId);
      if (userId) ids.add(userId);
    }
  }

  const primaryCartelId = Number(payload?.primaryCartelId ?? payload?.cartelId);
  if (Number.isInteger(primaryCartelId)) {
    const userId = findUserIdForCartel(session, primaryCartelId);
    if (userId) ids.add(userId);
  }

  return [...ids];
}

async function enrichWinnerAnnouncementDisplay(session, payload) {
  if (!payload) return payload;

  const userIds = collectWinnerUserIds(session, payload);
  const resolvedNames = await resolveDisplayNamesForUserIds(userIds);

  const winners = (Array.isArray(payload.winners) ? payload.winners : []).map(
    (winner) => {
      const userId =
        winner?.userId != null
          ? String(winner.userId)
          : findUserIdForCartel(session, winner?.cartelId);
      const syncRobotName = userId ? resolveRobotNameSync(userId) : null;
      const rawName = pickDisplayName(
        userId,
        syncRobotName || winner?.playerName || payload?.playerName,
        resolvedNames
      );
      const playerName =
        formatAnnouncementName(rawName, userId) ||
        formatAnnouncementName(syncRobotName, userId) ||
        rawName;
      const prize = Math.floor(Number(winner?.prize) || 0);
      const pool = Math.floor(
        Number(payload?.prizePool ?? payload?.prize ?? payload?.derash) || 0
      );
      const winnerCount = Math.max(
        1,
        Number(payload?.humanWinnerCount) ||
          (Array.isArray(payload?.winners) ? payload.winners.length : 1)
      );
      const share = Math.floor(Number(payload?.prizeSharePerWinner) || 0);
      const resolvedPrize =
        prize > 0
          ? prize
          : winnerCount > 1
            ? share || Math.floor(pool / winnerCount)
            : pool;
      return {
        ...winner,
        userId: userId || winner?.userId,
        playerName,
        prize: resolvedPrize,
      };
    }
  );

  const primaryCartelId = Number(payload.primaryCartelId ?? payload.cartelId);
  const primary =
    winners.find((winner) => Number(winner.cartelId) === primaryCartelId) ??
    winners[0];
  const primaryName = primary?.playerName || 'Player';

  return {
    ...payload,
    winners,
    winnerLabel: primaryName,
    playerName: primaryName,
    playerLabel: primaryName,
  };
}

module.exports = {
  isGenericPlayerName,
  pickDisplayName,
  resolveDisplayNamesForUserIds,
  enrichWinnerAnnouncementDisplay,
};
