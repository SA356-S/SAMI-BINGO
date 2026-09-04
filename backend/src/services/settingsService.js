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
  firstDepositBonusEnabled: false,
  firstDepositBonusPercent: 100,
  manualDepositEnabled: true,
};

const memorySettings = { ...DEFAULT_SETTINGS };
const SETTINGS_CACHE_MS = 30_000;
let settingsLoadedAt = 0;

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function snapshotSettings() {
  if (memorySettings.manualDepositEnabled == null) {
    memorySettings.manualDepositEnabled = DEFAULT_SETTINGS.manualDepositEnabled;
  }
  return { ...DEFAULT_SETTINGS, ...memorySettings };
}

function rememberSettings(doc) {
  if (doc) Object.assign(memorySettings, doc);
  if (memorySettings.manualDepositEnabled == null) {
    memorySettings.manualDepositEnabled = DEFAULT_SETTINGS.manualDepositEnabled;
  }
  settingsLoadedAt = Date.now();
}

async function getSettings() {
  if (isDbReady()) {
    if (settingsLoadedAt > 0 && Date.now() - settingsLoadedAt < SETTINGS_CACHE_MS) {
      return snapshotSettings();
    }
    let doc = await SettingsModel.findOne({
      settingsId: DEFAULT_SETTINGS.settingsId,
    }).lean();
    if (!doc) {
      doc = await SettingsModel.findOneAndUpdate(
        { settingsId: DEFAULT_SETTINGS.settingsId },
        { $setOnInsert: DEFAULT_SETTINGS },
        { upsert: true, new: true, lean: true }
      );
    }
    rememberSettings(doc);
    return snapshotSettings();
  }
  return snapshotSettings();
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
    rememberSettings(doc);
  } else {
    rememberSettings(patch);
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

function normalizeFirstDepositBonusPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function buildFirstDepositBonusPayload(enabled, percent) {
  return {
    firstDepositBonusEnabled: Boolean(enabled),
    firstDepositBonusPercent: normalizeFirstDepositBonusPercent(percent),
  };
}

async function getFirstDepositBonusSettings() {
  await getSettings();
  return buildFirstDepositBonusPayload(
    memorySettings.firstDepositBonusEnabled,
    memorySettings.firstDepositBonusPercent
  );
}

function getFirstDepositBonusSettingsSync() {
  return buildFirstDepositBonusPayload(
    memorySettings.firstDepositBonusEnabled,
    memorySettings.firstDepositBonusPercent
  );
}

async function updateFirstDepositBonusSettings({ enabled, percent } = {}) {
  const patch = {};

  if (enabled !== undefined) {
    patch.firstDepositBonusEnabled = Boolean(enabled);
  }
  if (percent !== undefined) {
    patch.firstDepositBonusPercent = normalizeFirstDepositBonusPercent(percent);
  }

  if (Object.keys(patch).length === 0) {
    return getFirstDepositBonusSettings();
  }

  if (isDbReady()) {
    const doc = await SettingsModel.findOneAndUpdate(
      { settingsId: DEFAULT_SETTINGS.settingsId },
      { $set: patch, $setOnInsert: { settingsId: DEFAULT_SETTINGS.settingsId } },
      { upsert: true, new: true, lean: true }
    );
    rememberSettings(doc);
  } else {
    rememberSettings(patch);
  }

  return buildFirstDepositBonusPayload(
    memorySettings.firstDepositBonusEnabled,
    memorySettings.firstDepositBonusPercent
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
    rememberSettings(doc);
  } else {
    rememberSettings(patch);
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
    rememberSettings(doc);
  } else {
    rememberSettings(patch);
  }

  return buildRobotAdvantagePreview(robotAdvantageLevel);
}

function resolveManualDepositEnabled(value) {
  if (value == null) return true;
  return Boolean(value);
}

function buildManualDepositPayload(enabled) {
  return {
    manualDepositEnabled: resolveManualDepositEnabled(enabled),
  };
}

async function getManualDepositSettings() {
  await getSettings();
  return buildManualDepositPayload(memorySettings.manualDepositEnabled);
}

function getManualDepositSettingsSync() {
  return buildManualDepositPayload(memorySettings.manualDepositEnabled);
}

async function updateManualDepositSettings({ enabled } = {}) {
  if (enabled === undefined) {
    return getManualDepositSettings();
  }

  const patch = { manualDepositEnabled: Boolean(enabled) };

  if (isDbReady()) {
    const doc = await SettingsModel.findOneAndUpdate(
      { settingsId: DEFAULT_SETTINGS.settingsId },
      { $set: patch, $setOnInsert: { settingsId: DEFAULT_SETTINGS.settingsId } },
      { upsert: true, new: true, lean: true }
    );
    rememberSettings(doc);
    if (memorySettings.manualDepositEnabled == null) {
      memorySettings.manualDepositEnabled = true;
    }
  } else {
    rememberSettings(patch);
  }

  return buildManualDepositPayload(memorySettings.manualDepositEnabled);
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
  getFirstDepositBonusSettings,
  getFirstDepositBonusSettingsSync,
  updateFirstDepositBonusSettings,
  getManualDepositSettings,
  getManualDepositSettingsSync,
  updateManualDepositSettings,
};
