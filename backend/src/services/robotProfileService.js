const { mongoose } = require('../config/db');
const { RobotProfileModel } = require('../models/RobotProfile');

const memoryRobots = new Map(); // robotId -> profile

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function normalizeId(robotId) {
  const raw = String(robotId || '').trim();
  if (!raw) return '';
  return raw.startsWith('robot:') ? raw : `robot:${raw}`;
}

async function getAllRobots() {
  if (isDbReady()) {
    const docs = await RobotProfileModel.find({}).lean();
    return docs.map((d) => ({ ...d, robotId: normalizeId(d.robotId) }));
  }

  return [...memoryRobots.values()].map((r) => ({ ...r }));
}

async function getRobot(robotId) {
  const id = normalizeId(robotId);
  if (!id) return null;

  if (isDbReady()) {
    const doc = await RobotProfileModel.findOne({ robotId: id }).lean();
    return doc ? { ...doc, robotId: normalizeId(doc.robotId) } : null;
  }

  return memoryRobots.get(id) ?? null;
}

async function setRobotEnabled(robotId, enabled) {
  const id = normalizeId(robotId);
  if (!id) return null;

  if (isDbReady()) {
    await RobotProfileModel.findOneAndUpdate(
      { robotId: id },
      { $set: { enabled: Boolean(enabled) } },
      { upsert: true, new: true }
    );
  }

  const current = memoryRobots.get(id) ?? (await getRobot(id));
  const next = current ? { ...current, enabled: Boolean(enabled), robotId: id } : null;
  if (next) memoryRobots.set(id, next);
  return next;
}

module.exports = {
  getAllRobots,
  getRobot,
  setRobotEnabled,
  normalizeId,
};

