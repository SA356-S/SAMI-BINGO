const { mongoose } = require('../config/db');
const { SettingsModel } = require('../models/Settings');
const {
  clampRobotAdvantageLevel,
  buildRobotAdvantagePreview,
} = require('../utils/robotAdvantage');
const {
  clampCardSelectionTime,
  resolveCardSelectionTime,
  CARD_SELECTION_TIME_MIN_SEC,
  CARD_SELECTION_TIME_MAX_SEC,
} = require('../utils/cardSelectionTime');

const REGISTRATION_BONUS_MIN = 0;
const REGISTRATION_BONUS_MAX = 100000;

const DEFAULT_SETTINGS = {
  settingsId: 'singleton',
  robotAdvantageLevel: 0,
  registrationBonusEnabled: false,
  registrationBonusAmount: 0,
};

const memorySettings = { ...DEFAULT_SETTINGS };

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

async function getSettings() {
  if (isDbReady()) {
    const doc = await SettingsModel.findOneAndUpdate(
      { settingsId: DEFAULT_SETTINGS.settingsId },
      { $setOnInsert: DEFAULT_SETTINGS },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memorySettings, doc);
    return { ...doc };
  }
  return { ...DEFAULT_SETTINGS, ...memorySettings };
}

function getSettingsSync() {
  return { ...DEFAULT_SETTINGS, ...memorySettings };
}

function getRobotAdvantageLevelSync() {
  return clampRobotAdvantageLevel(memorySettings.robotAdvantageLevel);
}

async function getRobotAdvantageSettings() {
  await getSettings();
  return buildRobotAdvantagePreview(getRobotAdvantageLevelSync());
}

function getRobotAdvantageSettingsSync() {
  return buildRobotAdvantagePreview(getRobotAdvantageLevelSync());
}

function getCardSelectionTimeSync() {
  return resolveCardSelectionTime(memorySettings.cardSelectionTime);
}

function buildCardSelectionTimePayload(seconds) {
  const cardSelectionTime = resolveCardSelectionTime(seconds);
  return {
    cardSelectionTime,
    minSeconds: CARD_SELECTION_TIME_MIN_SEC,
    maxSeconds: CARD_SELECTION_TIME_MAX_SEC,
  };
}

async function getCardSelectionTimeSettings() {
  await getSettings();
  return buildCardSelectionTimePayload(memorySettings.cardSelectionTime);
}

function isCardSelectionTimeInRange(seconds) {
  const n = Math.round(Number(seconds));
  return (
    Number.isFinite(n) &&
    n >= CARD_SELECTION_TIME_MIN_SEC &&
    n <= CARD_SELECTION_TIME_MAX_SEC
  );
}

async function updateCardSelectionTime(rawSeconds) {
  if (!isCardSelectionTimeInRange(rawSeconds)) {
    const err = new Error('cardSelectionTime_out_of_range');
    err.code = 'cardSelectionTime_out_of_range';
    throw err;
  }
  const cardSelectionTime = clampCardSelectionTime(rawSeconds);
  const patch = { cardSelectionTime };

  if (isDbReady()) {
    const doc = await SettingsModel.findOneAndUpdate(
      { settingsId: DEFAULT_SETTINGS.settingsId },
      { $set: patch, $setOnInsert: { settingsId: DEFAULT_SETTINGS.settingsId } },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memorySettings, doc);
  } else {
    Object.assign(memorySettings, patch);
  }

  return buildCardSelectionTimePayload(cardSelectionTime);
}

function clampRegistrationBonusAmount(raw) {
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(REGISTRATION_BONUS_MAX, Math.max(REGISTRATION_BONUS_MIN, n));
}

function buildRegistrationBonusPayload(enabled, amount) {
  return {
    registrationBonusEnabled: Boolean(enabled),
    registrationBonusAmount: clampRegistrationBonusAmount(amount),
    minAmount: REGISTRATION_BONUS_MIN,
    maxAmount: REGISTRATION_BONUS_MAX,
  };
}

async function getRegistrationBonusSettings() {
  await getSettings();
  return buildRegistrationBonusPayload(
    memorySettings.registrationBonusEnabled,
    memorySettings.registrationBonusAmount
  );
}

function getRegistrationBonusSettingsSync() {
  return buildRegistrationBonusPayload(
    memorySettings.registrationBonusEnabled,
    memorySettings.registrationBonusAmount
  );
}

async function updateRegistrationBonusSettings({ enabled, amount } = {}) {
  const patch = {};

  if (enabled !== undefined) {
    patch.registrationBonusEnabled = Boolean(enabled);
  }
  if (amount !== undefined) {
    patch.registrationBonusAmount = clampRegistrationBonusAmount(amount);
  }

  if (Object.keys(patch).length === 0) {
    return getRegistrationBonusSettings();
  }

  if (isDbReady()) {
    const doc = await SettingsModel.findOneAndUpdate(
      { settingsId: DEFAULT_SETTINGS.settingsId },
      { $set: patch, $setOnInsert: { settingsId: DEFAULT_SETTINGS.settingsId } },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memorySettings, doc);
  } else {
    Object.assign(memorySettings, patch);
  }

  return buildRegistrationBonusPayload(
    memorySettings.registrationBonusEnabled,
    memorySettings.registrationBonusAmount
  );
}

async function updateRobotAdvantageLevel(level) {
  const robotAdvantageLevel = clampRobotAdvantageLevel(level);
  const patch = { robotAdvantageLevel };

  if (isDbReady()) {
    const doc = await SettingsModel.findOneAndUpdate(
      { settingsId: DEFAULT_SETTINGS.settingsId },
      { $set: patch, $setOnInsert: { settingsId: DEFAULT_SETTINGS.settingsId } },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memorySettings, doc);
  } else {
    Object.assign(memorySettings, patch);
  }

  return buildRobotAdvantagePreview(robotAdvantageLevel);
}

module.exports = {
  getSettings,
  getSettingsSync,
  getRobotAdvantageLevelSync,
  getRobotAdvantageSettings,
  getRobotAdvantageSettingsSync,
  updateRobotAdvantageLevel,
  getCardSelectionTimeSync,
  getCardSelectionTimeSettings,
  updateCardSelectionTime,
  getRegistrationBonusSettings,
  getRegistrationBonusSettingsSync,
  updateRegistrationBonusSettings,
};
