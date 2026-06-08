const userRoleService = require('../services/userRoleService');

async function rejectIfBanned(userId, res) {
  const check = await userRoleService.assertUserNotBanned(userId);
  if (!check.ok && check.banned) {
    if (res) {
      res.status(403).json({
        ok: false,
        error: check.error,
        message: check.message,
        banReason: check.banReason,
        bannedAt: check.bannedAt,
      });
    }
    return check;
  }
  return null;
}

function rejectIfBannedSocket(userId, ack) {
  return userRoleService.assertUserNotBanned(userId).then((check) => {
    if (!check.ok && check.banned) {
      const err = {
        ok: false,
        error: check.error,
        message: check.message,
        banReason: check.banReason,
        bannedAt: check.bannedAt,
      };
      if (typeof ack === 'function') ack(err);
      return err;
    }
    return null;
  });
}

module.exports = { rejectIfBanned, rejectIfBannedSocket };
