const fs = require('fs');
const { loadEnv } = require('./config/env');
loadEnv();
require('./config/paymentMethods').getPaymentMethods();

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { connectDatabase } = require('./config/db');
const { hydrateWalletCacheFromDb } = require('./socket/walletManager');
const gameRoutes = require('./routes/gameRoutes');
const walletRoutes = require('./routes/walletRoutes');
const statsRoutes = require('./routes/statsRoutes');
const profileRoutes = require('./routes/profileRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const robotsRoutes = require('./routes/robotsRoutes');
const userRoutes = require('./routes/userRoutes');
const botDepositRoutes = require('./routes/botDepositRoutes');
const depositRoutes = require('./routes/depositRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const { setAdminIo } = require('./services/adminService');
const { registerSocketHandlers } = require('./socket');
const { gameManager } = require('./socket/gameManager');
const { startRobotEngine } = require('./services/robotEngine');
const robotConfigService = require('./services/robotConfigService');
const settingsService = require('./services/settingsService');
const robotManagementService = require('./services/robotManagementService');
const {
  mountMonorepoStatic,
  startTelegramBots,
  shutdownMonorepoServices,
  REPO_ROOT,
} = require('./startup/monorepoOrchestrator');

const PORT = process.env.PORT || 8080;

const FRONTEND_ORIGINS = (
  process.env.CORS_ORIGIN ||
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
  connectTimeout: 20000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,
    skipMiddlewares: true,
  },
  perMessageDeflate: {
    threshold: 1024,
  },
  maxHttpBufferSize: 1e6,
});

app.set('io', io);

app.use(
  cors({
    origin: FRONTEND_ORIGINS,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Admin-Token',
      'X-Admin-Telegram-Id',
      'X-Telegram-Init-Data',
      'x-telegram-init-data',
    ],
  })
);
app.use(express.json({ limit: '6mb' }));

app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'public', 'uploads'))
);

app.get('/', (_req, res) => {
  const frontendIndex = path.join(REPO_ROOT, 'frontend', 'dist', 'index.html');
  if (
    process.env.SERVE_MONOREPO_STATIC !== 'false' &&
    fs.existsSync(frontendIndex)
  ) {
    return res.sendFile(frontendIndex);
  }
  res.type('text').send('Server is running');
});

app.get('/health', (_req, res) => {
  const methods = require('./config/depositAccounts').getPublicDepositMethods();
  res.json({
    ok: true,
    service: 'edil-bingo-backend',
    activeSessions: gameManager.listSessions().length,
    lobbyGameId: gameManager.getLobbySession().gameId,
    miniAppUrl: require('./config/miniAppUrl').getMiniAppUrl(),
    deposit: {
      qbirrKeyConfigured: Boolean(String(process.env.QBIRR_API_KEY || '').trim()),
      telebirrAccounts: methods.telebirr.accounts.length,
      cbeConfigured: methods.cbe.enabled,
    },
  });
});

app.use('/api/game', gameRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/robots', robotsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/deposits', depositRoutes);
app.use('/bot', botDepositRoutes);

mountMonorepoStatic(app);

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  res.status(404).type('text').send('Not found');
});

setAdminIo(io);
registerSocketHandlers(io);
gameManager.startLobbyCountdownClock(io);

async function start() {
  await connectDatabase();
  try {
    const { WithdrawRequestModel } = require('./models/WithdrawRequest');
    await WithdrawRequestModel.syncIndexes();
  } catch (err) {
    console.warn('[db] WithdrawRequest index sync failed:', err?.message || err);
  }
  try {
    const { DepositModel } = require('./models/Deposit');
    await DepositModel.syncIndexes();
  } catch (err) {
    console.warn('[db] Deposit index sync failed:', err?.message || err);
  }
  await hydrateWalletCacheFromDb();
  await robotConfigService.getConfig();
  await settingsService.getSettings();
  await robotManagementService.listRobots();
  startRobotEngine(io);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Port ${PORT} is already in use. Stop the other process or set PORT in backend/.env`
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`[server] CORS origins: ${FRONTEND_ORIGINS.join(', ')}`);
    console.log(`[server] Lobby game id: ${gameManager.getLobbySession().gameId}`);
    void startTelegramBots();
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException', err);
  });

  const shutdown = async () => {
    console.log('[server] shutting down…');
    shutdownMonorepoServices();
    gameManager.stopLobbyCountdownClock();
    try {
      const { flushAllWalletPersists } = require('./socket/walletManager');
      await flushAllWalletPersists();
    } catch (err) {
      console.warn('[server] wallet flush on shutdown failed', err?.message);
    }
    try {
      const { mongoose } = require('./config/db');
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch (err) {
      console.warn('[server] Mongo close on shutdown failed', err?.message);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});

module.exports = { app, server, io };
