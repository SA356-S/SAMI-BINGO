const { mongoose } = require('../config/db');
const { RobotConfigModel } = require('../models/RobotConfig');
const { MAX_CARTELS_PER_PLAYER } = require('../config/constants');

const memoryConfig = { configId: 'singleton' };

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

const DEFAULT_CONFIG = {
  configId: 'singleton',
  enabledGlobal: true,
  minCards: 2,
  maxCards: 2,
  maxActiveRobots: 10,
  activityLevel: 1,
  joinJitterMs: 15000,
  leaveJitterMs: 20000,
  bankBalance: 10000,
};

// Ensure sync bank ops always have sane defaults before the first DB load.
Object.assign(memoryConfig, DEFAULT_CONFIG);

async function getConfig() {
  if (isDbReady()) {
    const doc = await RobotConfigModel.findOneAndUpdate(
      { configId: DEFAULT_CONFIG.configId },
      { $setOnInsert: DEFAULT_CONFIG },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memoryConfig, doc);
    return { ...doc };
  }

  return { ...DEFAULT_CONFIG, ...memoryConfig };
}

function getConfigSync() {
  return { ...DEFAULT_CONFIG, ...memoryConfig };
}

async function updateConfig(patch = {}) {
  const current = await getConfig();
  const merged = { ...current, ...patch };

  // Clamp for current game constraints.
  merged.minCards = Math.max(1, Math.floor(Number(merged.minCards) || 1));
  merged.maxCards = Math.max(merged.minCards, Math.floor(Number(merged.maxCards) || merged.minCards));
  merged.maxCards = Math.min(merged.maxCards, MAX_CARTELS_PER_PLAYER);
  merged.minCards = Math.min(merged.minCards, MAX_CARTELS_PER_PLAYER);
  merged.maxActiveRobots = Math.max(0, Math.floor(Number(merged.maxActiveRobots) || 0));
  merged.activityLevel = Math.max(0, Math.min(1.5, Number(merged.activityLevel) || 1));
  merged.joinJitterMs = Math.max(0, Number(merged.joinJitterMs) || 0);
  merged.leaveJitterMs = Math.max(0, Number(merged.leaveJitterMs) || 0);
  merged.bankBalance = Math.max(0, Number(merged.bankBalance) || 0);

  if (isDbReady()) {
    const doc = await RobotConfigModel.findOneAndUpdate(
      { configId: DEFAULT_CONFIG.configId },
      { $set: merged },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memoryConfig, doc);
    return { ...doc };
  }

  Object.assign(memoryConfig, merged);
  return { ...merged };
}

function topupBankSync(amount) {
  const v = Math.max(0, Number(amount) || 0);
  if (v <= 0) return { ok: false, error: 'invalid_amount' };

  memoryConfig.bankBalance = Math.max(
    0,
    Number(memoryConfig.bankBalance ?? DEFAULT_CONFIG.bankBalance) + v
  );

  // Persist asynchronously (do not block gameplay start).
  if (isDbReady()) {
    void RobotConfigModel.findOneAndUpdate(
      { configId: DEFAULT_CONFIG.configId },
      { $inc: { bankBalance: v } },
      { upsert: true }
    ).catch(() => {});
  }

  return { ok: true, bankBalance: memoryConfig.bankBalance };
}

async function topupBank(amount) {
  const v = Math.max(0, Number(amount) || 0);
  if (v <= 0) return null;

  if (isDbReady()) {
    const doc = await RobotConfigModel.findOneAndUpdate(
      { configId: DEFAULT_CONFIG.configId },
      { $inc: { bankBalance: v } },
      { upsert: true, new: true, lean: true }
    );
    Object.assign(memoryConfig, doc);
    return doc;
  }

  memoryConfig.bankBalance = Math.max(0, (memoryConfig.bankBalance ?? DEFAULT_CONFIG.bankBalance) + v);
  return getConfig();
}

function deductBankSync(amount) {
  const v = Math.max(0, Number(amount) || 0);
  if (v <= 0) return { ok: false, error: 'invalid_amount' };

  const current = Number(memoryConfig.bankBalance ?? DEFAULT_CONFIG.bankBalance);
  if (current < v) return { ok: false, error: 'insufficient_bank_balance' };

  memoryConfig.bankBalance = current - v;

  if (isDbReady()) {
    // Best-effort persist; memory is authoritative for this process.
    void RobotConfigModel.findOneAndUpdate(
      { configId: DEFAULT_CONFIG.configId },
      { $inc: { bankBalance: -v } },
      { upsert: true }
    ).catch(() => {});
  }

  return { ok: true, bankBalance: memoryConfig.bankBalance };
}

async function deductBank(amount) {
  const v = Math.max(0, Number(amount) || 0);
  if (v <= 0) return { ok: false, error: 'invalid_amount' };

  // Atomic-ish: only succeed if current bankBalance >= v.
  if (isDbReady()) {
    const doc = await RobotConfigModel.findOneAndUpdate(
      { configId: DEFAULT_CONFIG.configId, bankBalance: { $gte: v } },
      { $inc: { bankBalance: -v } },
      { upsert: true, new: true, lean: true }
    );
    if (!doc) return { ok: false, error: 'insufficient_bank_balance' };
    Object.assign(memoryConfig, doc);
    return { ok: true, bankBalance: doc.bankBalance };
  }

  const current = Number(memoryConfig.bankBalance ?? DEFAULT_CONFIG.bankBalance);
  if (current < v) return { ok: false, error: 'insufficient_bank_balance' };
  memoryConfig.bankBalance = current - v;
  return { ok: true, bankBalance: memoryConfig.bankBalance };
}

module.exports = {
  getConfig,
  getConfigSync,
  updateConfig,
  topupBank,
  deductBank,
  topupBankSync,
  deductBankSync,
};

