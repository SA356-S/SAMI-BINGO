'use strict';

/**
 * Run work on the next event-loop turn so Socket.IO hot paths can return quickly.
 * @param {() => void | Promise<void>} fn
 */
function runDeferred(fn) {
  setImmediate(() => {
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
    } catch {
      /* deferred task failed — non-fatal */
    }
  });
}

/**
 * Yield one event-loop turn (use between long sequential batches).
 * @returns {Promise<void>}
 */
function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  runDeferred,
  yieldEventLoop,
};
