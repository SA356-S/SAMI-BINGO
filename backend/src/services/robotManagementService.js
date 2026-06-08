const { mongoose } = require('../config/db');
const { RobotModel } = require('../models/Robot');

const memoryRobots = new Map();

const ERROR_MESSAGES = {
  name_required: 'Robot name is required',
  name_too_long: 'Robot name must be 64 characters or fewer',
  name_duplicate: 'A robot with this name already exists',
  robots_create_failed: 'Failed to save robot',
};

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function toRobotId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (raw.startsWith('robot:')) return raw;
  return `robot:${raw}`;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatRobot(doc) {
  const id = String(doc._id ?? doc.id);
  const status = doc.status === 'on' ? 'on' : 'off';
  return {
    id,
    robotId: toRobotId(id),
    name: String(doc.name || '').trim(),
    status,
    enabled: status === 'on',
    createdAt: doc.createdAt ?? new Date(),
  };
}

async function findRobotByName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || !isDbReady()) return null;
  return RobotModel.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
  }).lean();
}

async function listRobots() {
  if (isDbReady()) {
    const docs = await RobotModel.find({}).sort({ createdAt: -1 }).lean();
    const list = docs.map(formatRobot);
    memoryRobots.clear();
    for (const r of list) memoryRobots.set(r.robotId, r);
    return list;
  }
  return [...memoryRobots.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function listActiveRobotsForEngine() {
  const all = await listRobots();
  return all.filter((r) => r.status === 'on');
}

function listActiveRobotsForEngineSync() {
  return [...memoryRobots.values()].filter((r) => r.status === 'on');
}

async function createRobot(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'name_required',
      message: ERROR_MESSAGES.name_required,
    };
  }
  if (trimmed.length > 64) {
    return {
      ok: false,
      error: 'name_too_long',
      message: ERROR_MESSAGES.name_too_long,
    };
  }

  const duplicateMem = [...memoryRobots.values()].some(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (duplicateMem) {
    return {
      ok: false,
      error: 'name_duplicate',
      message: ERROR_MESSAGES.name_duplicate,
    };
  }

  if (isDbReady()) {
    try {
      const existing = await findRobotByName(trimmed);
      if (existing) {
        return {
          ok: false,
          error: 'name_duplicate',
          message: ERROR_MESSAGES.name_duplicate,
        };
      }

      const doc = await RobotModel.create({ name: trimmed, status: 'off' });
      const formatted = formatRobot(doc.toObject ? doc.toObject() : doc);
      memoryRobots.set(formatted.robotId, formatted);
      return { ok: true, robot: formatted };
    } catch (err) {
      console.error('[robotManagement] createRobot DB error:', err);
      if (String(err?.code) === '11000') {
        return {
          ok: false,
          error: 'name_duplicate',
          message: ERROR_MESSAGES.name_duplicate,
        };
      }
      return {
        ok: false,
        error: 'robots_create_failed',
        message: err?.message || ERROR_MESSAGES.robots_create_failed,
      };
    }
  }

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const formatted = {
    id,
    robotId: toRobotId(id),
    name: trimmed,
    status: 'off',
    enabled: false,
    createdAt: new Date(),
  };
  memoryRobots.set(formatted.robotId, formatted);
  return { ok: true, robot: formatted };
}

async function setRobotStatus(robotId, status) {
  const id = toRobotId(robotId);
  if (!id) return { ok: false, error: 'robot_not_found', message: 'Robot not found' };

  const next = status === 'on' ? 'on' : 'off';
  const mongoId = id.replace(/^robot:/, '');

  if (isDbReady() && /^[a-f0-9]{24}$/i.test(mongoId)) {
    const doc = await RobotModel.findByIdAndUpdate(
      mongoId,
      { $set: { status: next } },
      { new: true, lean: true }
    );
    if (!doc) return { ok: false, error: 'robot_not_found', message: 'Robot not found' };
    const formatted = formatRobot(doc);
    memoryRobots.set(formatted.robotId, formatted);
    if (next === 'on') {
      try {
        void require('./robotEngine').refreshActiveRobotsCache();
      } catch {
        /* engine not started yet */
      }
    }
    return { ok: true, robot: formatted };
  }

  const current = memoryRobots.get(id);
  if (!current) return { ok: false, error: 'robot_not_found', message: 'Robot not found' };
  const formatted = { ...current, status: next, enabled: next === 'on' };
  memoryRobots.set(id, formatted);
  if (next === 'on') {
    try {
      void require('./robotEngine').refreshActiveRobotsCache();
    } catch {
      /* engine not started yet */
    }
  }
  return { ok: true, robot: formatted };
}

async function setRobotEnabled(robotId, enabled) {
  return setRobotStatus(robotId, enabled ? 'on' : 'off');
}

module.exports = {
  listRobots,
  listActiveRobotsForEngine,
  listActiveRobotsForEngineSync,
  createRobot,
  setRobotStatus,
  setRobotEnabled,
  toRobotId,
  ERROR_MESSAGES,
};
