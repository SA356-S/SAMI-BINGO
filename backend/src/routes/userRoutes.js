const express = require('express');
const {
  requireAdmin,
  attachPanelAdmin,
  requireManager,
} = require('../middleware/adminAuth');
const {
  searchUsers,
  addBalance,
  listRecentUsers,
} = require('../services/userAdminService');
const userRoleService = require('../services/userRoleService');

const router = express.Router();

router.use(requireAdmin);
router.use(attachPanelAdmin);

router.get('/management', requireManager, async (req, res) => {
  try {
    const result = await userRoleService.listUsersForManagement({
      limit: req.query.limit,
      skip: req.query.skip,
      search: req.query.search ?? req.query.q,
    });
    if (!result.ok) {
      return res.status(503).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] management list error', err);
    res.status(500).json({ ok: false, error: 'list_failed' });
  }
});

router.put('/:id/make-admin', requireManager, async (req, res) => {
  try {
    const result = await userRoleService.makeAdmin(req.params.id);
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] make-admin error', err);
    res.status(500).json({ ok: false, error: 'make_admin_failed' });
  }
});

router.put('/:id/remove-admin', requireManager, async (req, res) => {
  try {
    const result = await userRoleService.removeAdmin(req.params.id);
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] remove-admin error', err);
    res.status(500).json({ ok: false, error: 'remove_admin_failed' });
  }
});

router.put('/:id/make-manager', requireManager, async (req, res) => {
  try {
    const result = await userRoleService.makeManager(req.params.id);
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] make-manager error', err);
    res.status(500).json({ ok: false, error: 'make_manager_failed' });
  }
});

router.put('/:id/remove-manager', requireManager, async (req, res) => {
  try {
    const targetRole = req.body?.role === 'user' ? 'user' : 'admin';
    const result = await userRoleService.removeManager(req.params.id, targetRole);
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] remove-manager error', err);
    res.status(500).json({ ok: false, error: 'remove_manager_failed' });
  }
});

router.put('/:id/ban', requireManager, async (req, res) => {
  try {
    const result = await userRoleService.banUser(
      req.params.id,
      req.body?.banReason ?? req.body?.reason
    );
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] ban error', err);
    res.status(500).json({ ok: false, error: 'ban_failed' });
  }
});

router.put('/:id/unban', requireManager, async (req, res) => {
  try {
    const result = await userRoleService.unbanUser(req.params.id);
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] unban error', err);
    res.status(500).json({ ok: false, error: 'unban_failed' });
  }
});

router.get('/recent', requireManager, async (req, res) => {
  try {
    const result = await listRecentUsers(req.query.limit);
    if (!result.ok) {
      return res.status(503).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] recent error', err);
    res.status(500).json({ ok: false, error: 'list_failed' });
  }
});

router.get('/search', requireManager, async (req, res) => {
  try {
    const result = await searchUsers(req.query.query);
    if (!result.ok) {
      const status =
        result.error === 'user_not_found'
          ? 404
          : result.error === 'database_unavailable'
            ? 503
            : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] search error', err);
    res.status(500).json({ ok: false, error: 'search_failed' });
  }
});

router.post('/add-balance', requireManager, async (req, res) => {
  try {
    const result = await addBalance(
      req.body?.userId,
      req.body?.amount,
      req.body?.note
    );
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[users] add-balance error', err);
    res.status(500).json({ ok: false, error: 'add_balance_failed' });
  }
});

module.exports = router;
