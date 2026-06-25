const { gameManager } = require('./socket/gameManager');
const {
  MIN_PLAYERS,
  GAME_ENTRY_STAKE,
  MIN_TOTAL_CARTELAS_TO_START,
  ROUND_END_DISPLAY_MS,
} = require('./config/constants');
const {
  resolveUserId,
  getOrInitWallet,
  toSnapshot,
  chargeAndStartSession,
  canAffordGameplayEntry,
  emitWalletSnapshot,
} = require('./socket/walletManager');
const {
  getWalletPageData,
  getOrInitProfile,
} = require('./services/walletTransactionService');
const {
  getProfileData,
  setSoundEffects,
} = require('./services/profileService');
const {
  resolveTelegramUserIdFromHandshake,
  resolveGameplayUserId,
  parseInitDataUser,
  isValidTelegramId,
} = require('./utils/telegramAuth');
const { verifyAdminToken } = require('./middleware/adminAuth');
const { rejectIfBannedSocket } = require('./utils/banGate');
const {
  emitGameStatus,
  getDashboardSnapshotAsync,
  emitRobotsSnapshot,
} = require('./services/adminService');

function attachPlayerUserId(session, socketId, userId) {
  const player = session.players.get(socketId);
  if (!player) return;
  player.socketId = String(socketId);
  if (userId) player.userId = String(userId);
}

function attachPlayerIdentity(session, socket, payload = {}) {
  const player = session.players.get(socket.id);
  if (!player) return;
  player.socketId = socket.id;
  player.userId = resolveUserId(socket, payload);
  if (payload.playerName || socket.data.playerName) {
    player.playerName = payload.playerName || socket.data.playerName;
  }
}

async function deliverEndedGameWinnerToSocket(
  session,
  io,
  socket,
  reason = 'late-join',
  { includeAudio = true } = {}
) {
  if (!session || !socket || session.status !== 'ended' || !session.winner) {
    return null;
  }

  const winnerPayload =
    session.winnerDisplayPayload ??
    (await session.buildWinnerAnnouncementPayloadForDisplay(session.winner));

  const winnerUserId =
    winnerPayload?.winners?.[0]?.userId ??
    session.winner?.userId ??
    null;

  console.info('[game][bingo-announce] Delivering ended-game winner to socket', {
    gameId: session.gameId,
    roomId: session.roomName,
    socketId: socket.id,
    winnerUserId,
    reason,
    includeAudio,
  });

  socket.emit('game:winner', winnerPayload);
  socket.emit('game:over', winnerPayload);
  socket.emit('game:ended', winnerPayload);
  if (includeAudio) {
    socket.emit('bingo_announce', {
      gameId: session.gameId,
      serverTime: Date.now(),
      primaryCartelId: winnerPayload.primaryCartelId,
      cartelId: winnerPayload.primaryCartelId,
    });
  }

  return winnerPayload;
}

/**
 * Socket.io handlers for EDIL BINGO — game events + dual-wallet management.
 * Emits wallet:update after connect, deposit, and Bingo wins.
 */
function registerSocketHandlers(io) {
  io.use((socket, next) => {
    const resolved = resolveTelegramUserIdFromHandshake(socket.handshake);
    const initUser = parseInitDataUser(socket.handshake?.auth?.initData);

    if (resolved?.userId) {
      socket.data.userId = resolved.userId;
      socket.data.telegramUserId = resolved.userId;
      console.log('[telegram] websocket user connected', {
        userId: resolved.userId,
        source: resolved.source,
        username: initUser?.username ?? socket.handshake?.auth?.username,
      });
    }
    next();
  });

  io.on('connection', (socket) => {
    const emitRoomGameUpdate = (session, { lightweight = false } = {}) => {
      if (!session) return;
      const duringCalling = session.status === 'calling';
      const slim = lightweight && duringCalling;
      io.to(session.roomName).emit(
        'game:update',
        session.toRoomBroadcastState({
          includeBallHistory: !slim,
          includePlayers: !slim,
          includeOwnership: !slim,
        })
      );
    };

    const emitRoomPlayersChurn = (session) => {
      if (!session) return;
      const duringCalling = session.status === 'calling';
      const payload = {
        gameId: session.gameId,
        playersCount: session.playersCount,
      };
      if (!duringCalling) {
        payload.players = session.buildPlayersList();
      }
      io.to(session.roomName).emit('game:players', payload);
    };

    socket.on('admin:subscribe', async (payload = {}, ack) => {
      const token =
        payload.token ??
        socket.handshake?.auth?.adminToken ??
        socket.handshake?.auth?.token;
      if (!verifyAdminToken(token)) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'admin_unauthorized' });
        }
        return;
      }
      socket.join('admin');
      socket.data.isAdmin = true;
      const dash = await getDashboardSnapshotAsync();
      console.log('[admin] websocket connected', { socketId: socket.id });
      if (typeof ack === 'function') {
        ack({ ok: true, ...dash });
      }
      emitGameStatus(
        require('./socket/gameManager').gameManager.getLobbySession()
      );
      void emitRobotsSnapshot();
      try {
        const { listWithdrawRequests } = require('./services/withdrawAdminService');
        const withdrawPayload = await listWithdrawRequests({ limit: 100 });
        socket.emit('admin:withdrawRequests', withdrawPayload);
      } catch (err) {
        console.warn('[admin] withdraw snapshot on subscribe failed', err?.message);
      }
      try {
        const { getDailyProfitSummary } = require('./services/dailyProfitService');
        const profitPayload = await getDailyProfitSummary();
        socket.emit('admin:dailyProfit', profitPayload);
      } catch (err) {
        console.warn('[admin] daily profit snapshot on subscribe failed', err?.message);
      }
    });

    const userId = resolveUserId(socket);
    socket.data.userId = userId;
    socket.data.socketId = socket.id;

    const initUser = parseInitDataUser(socket.handshake?.auth?.initData);
    const identityExtras = {
      phone: socket.handshake?.auth?.phone,
      firstName:
        socket.handshake?.auth?.firstName ?? initUser?.first_name,
      lastName: socket.handshake?.auth?.lastName ?? initUser?.last_name,
      username: socket.handshake?.auth?.username ?? initUser?.username,
      telegramId: socket.data.telegramUserId ?? userId,
      initData: socket.handshake?.auth?.initData,
    };

    if (isValidTelegramId(userId)) {
      getOrInitProfile(userId, identityExtras).catch(() => {});
      getProfileData(userId, identityExtras)
        .then((profile) => {
          console.log('[telegram] profile loaded for socket', {
            userId,
            username: profile.username,
            phone: profile.phone ? '(set)' : '(empty)',
          });
          socket.emit('profile:update', profile);
        })
        .catch((err) => {
          console.warn('[telegram] profile load failed', userId, err?.message);
        });
      getOrInitWallet(userId);
      emitWalletSnapshot(socket, getOrInitWallet(userId));
    }

    socket.join('clients');

    console.log(
      `[socket] connected socketId=${socket.id} userId=${userId}`
    );

    socket.on('wallet:register', async (payload = {}, ack) => {
      const id = resolveUserId(socket, payload);
      socket.data.userId = id;
      if (payload.phone) socket.data.phone = String(payload.phone);

      try {
        const page = await getWalletPageData(id, {
          ...payload,
          telegramId: payload.telegramId ?? id,
          firstName: payload.firstName ?? socket.handshake?.auth?.firstName,
          username: payload.username ?? socket.handshake?.auth?.username,
        });
        emitWalletSnapshot(socket, getOrInitWallet(id));
        socket.emit('wallet:page', page);
        if (typeof ack === 'function') ack({ ok: true, ...page });
      } catch (err) {
        const snapshot = toSnapshot(getOrInitWallet(id));
        if (typeof ack === 'function') ack({ ok: true, ...snapshot });
      }
    });

    socket.on('profile:get', async (payload = {}, ack) => {
      const id = resolveUserId(socket, payload);
      try {
        const profile = await getProfileData(id, {
          ...payload,
          telegramId: payload.telegramId ?? id,
          firstName: payload.firstName ?? socket.handshake?.auth?.firstName,
          username: payload.username ?? socket.handshake?.auth?.username,
        });
        socket.emit('profile:update', profile);
        if (typeof ack === 'function') ack({ ok: true, ...profile });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: err?.message ?? 'profile failed' });
        }
      }
    });

    socket.on('profile:sound', async (payload = {}, ack) => {
      const id = resolveUserId(socket, payload);
      try {
        if ('soundEffectsEnabled' in payload) {
          await setSoundEffects(id, payload.soundEffectsEnabled);
        }
        const profile = await getProfileData(id);
        socket.emit('profile:update', profile);
        if (typeof ack === 'function') ack({ ok: true, ...profile });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: err?.message ?? 'profile sound failed' });
        }
      }
    });

    socket.on('game:join', async (payload = {}, ack) => {
      const {
        gameId,
        cartelIds = [],
        selectedCartels,
        playerName,
        stake,
        autoStart,
      } = payload;

      const ids = selectedCartels ?? cartelIds;
      const session = gameManager.resolveGameplaySession(
        gameId ? String(gameId) : null
      );

      if (stake != null) session.stake = Number(stake) || GAME_ENTRY_STAKE;

      socket.join(session.roomName);
      socket.data.gameId = session.gameId;
      socket.data.playerName = playerName || 'Player';

      const joinUserId = resolveUserId(socket, payload);
      socket.data.userId = joinUserId;

      const bannedErr = await rejectIfBannedSocket(joinUserId, ack);
      if (bannedErr) return;

      if (Array.isArray(ids) && ids.length > 0) {
        const result = session.assignCartels(
          socket.id,
          ids,
          socket.data.playerName,
          joinUserId
        );
        if (!result.ok) {
          const err = { ok: false, error: result.error };
          if (typeof ack === 'function') ack(err);
          socket.emit('game:error', err);
          return;
        }
        attachPlayerUserId(session, socket.id, joinUserId);
        attachPlayerIdentity(session, socket, payload);
        gameManager.setUserGame(joinUserId, session.gameId);
      } else {
        session.players.set(socket.id, {
          socketId: socket.id,
          userId: joinUserId,
          playerName: socket.data.playerName,
          cartelIds: [],
          cards: [],
        });
      }

      const inProgress =
        session.status === 'calling' ||
        (session.status === 'ended' && session.resetTimer);

      if (inProgress) {
        session.emitActiveGameSync(io, socket, joinUserId);
        await deliverEndedGameWinnerToSocket(session, io, socket, 'game:join');
      } else {
        const state = session.toPublicState(socket.id, joinUserId);
        socket.emit('game:joined', {
          ok: true,
          gameId: session.gameId,
          gameStatus: session.getPublicGameStatus(),
          ...state,
        });
      }

      emitRoomPlayersChurn(session);

      emitRoomGameUpdate(session, { lightweight: true });

      // Never restart the ball loop when joining a live round.
      const shouldStartRound =
        !inProgress &&
        (payload.startRound === true ||
          (autoStart === true && payload.forceStart === true));

      if (shouldStartRound) {
        const forceStart = payload.forceStart === true;
        const canStart =
          forceStart
            ? typeof session.hasMinimumCartelasToStart === 'function'
              ? session.hasMinimumCartelasToStart()
              : session.getTotalSelectedCartelas() >= MIN_TOTAL_CARTELAS_TO_START
            : session.canStartCalling();

        if (canStart) {
          const startResult = chargeAndStartSession(session, io, { forceStart });
          if (!startResult.ok) {
            const err = { ok: false, error: startResult.error, ...startResult };
            socket.emit('game:error', err);
            emitWalletSnapshot(socket, getOrInitWallet(joinUserId));
            if (typeof ack === 'function') ack(err);
            return;
          }
          session.emitPerPlayer(io, 'game:started');
        }
      }

      if (typeof ack === 'function') {
        const ackPayload = inProgress
          ? session.buildActiveGameSyncPayload(socket.id, joinUserId)
          : {
              ok: true,
              gameId: session.gameId,
              gameStatus: session.getPublicGameStatus(),
              ...session.toPublicState(socket.id, joinUserId),
            };
        ack(ackPayload);
      }
    });

    /** Timer reached 0 — charge entry fees and begin ball loop */
    socket.on('game:round-start', (payload = {}, ack) => {
      const gameId = payload.gameId || socket.data.gameId;
      const session = gameManager.resolveGameplaySession(gameId);

      if (!session) {
        const err = { ok: false, error: 'Game not found' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const ids = payload.selectedCartels ?? payload.cartelIds ?? [];
      const roundUserId = resolveUserId(socket, payload);
      socket.data.userId = roundUserId;
      socket.join(session.roomName);
      socket.data.gameId = session.gameId;

      if (Array.isArray(ids) && ids.length > 0) {
        const assignResult = session.assignCartels(
          socket.id,
          ids,
          payload.playerName || socket.data.playerName,
          roundUserId
        );
        if (!assignResult.ok) {
          const err = { ok: false, error: assignResult.error };
          if (typeof ack === 'function') ack(err);
          socket.emit('game:error', err);
          return;
        }
        attachPlayerUserId(session, socket.id, roundUserId);
        attachPlayerIdentity(session, socket, payload);
      }

      const hasEnoughCartelas =
        typeof session.hasMinimumCartelasToStart === 'function'
          ? session.hasMinimumCartelasToStart()
          : (session.takenCartels?.size ?? 0) >= MIN_TOTAL_CARTELAS_TO_START;

      if (!hasEnoughCartelas) {
        const err = {
          ok: false,
          error: 'insufficient_cartels',
          message: `At least ${MIN_TOTAL_CARTELAS_TO_START} cartelas must be selected in the lobby to start`,
        };
        if (typeof ack === 'function') ack(err);
        socket.emit('game:error', err);
        return;
      }

      if (session.status === 'calling' || (session.status === 'ended' && session.resetTimer)) {
        session.emitActiveGameSync(io, socket, roundUserId);
        const syncPayload = session.buildActiveGameSyncPayload(socket.id, roundUserId);
        if (typeof ack === 'function') {
          ack({ ...syncPayload, alreadyStarted: true });
        }
        return;
      }

      if (session.status === 'waiting') {
        session.ensureLobbyCountdownRunning();
        const remaining = session.getLobbyCountdownRemaining();
        if (remaining > 0) {
          const syncPayload = session.toLobbySyncPayload(roundUserId);
          const err = {
            ok: false,
            error: 'countdown_in_progress',
            countdownSeconds: remaining,
            ...syncPayload,
          };
          if (typeof ack === 'function') ack(err);
          return;
        }

        const started = session.tryStartLobbyGame(io, { fromCountdownExpiry: true });
        if (!started) {
          const err = {
            ok: false,
            error: 'cannot_start_yet',
            message: `At least ${MIN_TOTAL_CARTELAS_TO_START} cartelas must be selected in the lobby before the round starts`,
            ...session.toLobbySyncPayload(roundUserId),
          };
          if (typeof ack === 'function') ack(err);
          return;
        }

        const syncPayload = session.buildActiveGameSyncPayload(socket.id, roundUserId);
        if (typeof ack === 'function') {
          ack({ ok: true, status: 'calling', ...syncPayload });
        }
        return;
      }

      const startResult = chargeAndStartSession(session, io, {
        forceStart: payload.forceStart !== false,
      });

      if (!startResult.ok) {
        const err = { ok: false, error: startResult.error, ...startResult };
        socket.emit('game:error', err);
        emitWalletSnapshot(socket, getOrInitWallet(roundUserId));
        if (typeof ack === 'function') ack(err);
        return;
      }

      session.emitPerPlayer(io, 'game:started');

      for (const p of session.allSeatedPlayers()) {
        if (p.userId) gameManager.setUserGame(p.userId, session.gameId);
      }

      const state = session.toPublicState(socket.id);
      if (typeof ack === 'function') {
        ack({ ok: true, status: 'calling', ...state, ...startResult });
      }
    });

    socket.on('game:select-cartels', async (payload = {}, ack) => {
      const { gameId, cartelIds = [], selectedCartels, playerName } = payload;
      const ids = selectedCartels ?? cartelIds;
      const session = gameManager.resolveGameplaySession(
        gameId ? String(gameId) : null
      );

      socket.join(session.roomName);
      socket.data.gameId = session.gameId;

      const selectUserId = resolveGameplayUserId(socket, payload);
      if (!selectUserId) {
        const err = { ok: false, error: 'telegram_auth_required' };
        if (typeof ack === 'function') ack(err);
        socket.emit('game:error', err);
        return;
      }
      socket.data.userId = selectUserId;

      const bannedErr = await rejectIfBannedSocket(selectUserId, ack);
      if (bannedErr) return;
      socket.data.telegramUserId = selectUserId;

      const normalizedIds = Array.isArray(ids)
        ? ids.map(Number).filter((n) => n >= 1)
        : [];

      if (normalizedIds.length > 0) {
        const afford = canAffordGameplayEntry(
          selectUserId,
          normalizedIds.length,
          session.stake
        );
        if (!afford.ok) {
          const myCartels = session.getCartelsForUser(selectUserId);
          const err = {
            ok: false,
            error: 'insufficient_balance',
            message: 'Insufficient balance',
            required: afford.required,
            available: afford.available,
            myCartels,
            selectedCartels: myCartels,
            ...session.toLobbySyncPayload(selectUserId),
          };
          emitWalletSnapshot(socket, afford.wallet ?? getOrInitWallet(selectUserId));
          if (typeof ack === 'function') ack(err);
          socket.emit('game:error', err);
          return;
        }
      }

      const result = session.assignCartels(
        socket.id,
        ids,
        playerName || socket.data.playerName,
        selectUserId
      );

      if (!result.ok) {
        if (typeof ack === 'function') ack({ ok: false, error: result.error });
        socket.emit('game:error', { ok: false, error: result.error });
        return;
      }

      attachPlayerUserId(session, socket.id, selectUserId);
      attachPlayerIdentity(session, socket, payload);

      const response = {
        ok: true,
        gameId: session.gameId,
        selectedCartels: normalizedIds,
        myCartels: normalizedIds,
        takenCartels: [...session.takenCartels],
        playersCount: session.playersCount,
      };

      session.emitLobbySelectionUpdate(io);
      emitRoomGameUpdate(session, { lightweight: true });

      if (typeof ack === 'function') {
        ack({
          ...response,
          ...session.toLobbySyncPayload(selectUserId),
          selectionLocked: session.isSelectionLocked(),
        });
      }
    });

    socket.on('game:lobby-sync', async (payload = {}, ack) => {
      const session = gameManager.getLobbySession();
      const syncUserId = resolveGameplayUserId(socket, payload);
      if (!syncUserId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'telegram_auth_required' });
        }
        return;
      }

      const bannedErr = await rejectIfBannedSocket(syncUserId, ack);
      if (bannedErr) return;

      if (syncUserId && session.awayPlayers.has(String(syncUserId))) {
        session.rejoinPlayer(socket.id, syncUserId);
        socket.join(session.roomName);
        socket.data.gameId = session.gameId;
        socket.data.userId = syncUserId;
      }

      socket.join(session.roomName);
      socket.data.gameId = session.gameId;

      const sync = session.toLobbySyncPayload(syncUserId);
      const selectionLocked = session.isSelectionLocked();
      const myCartels = session.getCartelsForUser(syncUserId);

      if (selectionLocked && myCartels.length === 0) {
        const watchState = session.toPublicState(socket.id, syncUserId);
        const watchPayload = {
          ok: true,
          ...sync,
          ...watchState,
          watchingOnly: true,
          gameStatus: session.getPublicGameStatus(),
          selectionLocked: true,
          gameInProgress: session.status === 'calling',
        };
        socket.emit('game:lobby-tick', watchPayload);
        if (typeof ack === 'function') ack(watchPayload);
        return;
      }

      socket.emit('game:lobby-tick', {
        ...sync,
        takenCartels: [...session.takenCartels],
        cartelOwnership: session.buildCartelOwnership(socket.id, syncUserId),
        selectionLocked,
      });
      if (typeof ack === 'function') {
        ack({
          ok: true,
          ...sync,
          takenCartels: [...session.takenCartels],
          selectionLocked,
        });
      }
    });

    /** Join an in-progress game as a spectator (no cartelas). */
    socket.on('game:watch', async (payload = {}, ack) => {
      const watchUserId = resolveGameplayUserId(socket, payload);
      if (!watchUserId) {
        const err = { ok: false, error: 'telegram_auth_required' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const bannedErr = await rejectIfBannedSocket(watchUserId, ack);
      if (bannedErr) return;

      const session = gameManager.getLobbySession();
      socket.join(session.roomName);
      socket.data.gameId = session.gameId;
      socket.data.userId = watchUserId;
      socket.data.watchingOnly = true;

      const inProgress =
        session.status === 'calling' ||
        (session.status === 'ended' && session.resetTimer);

      const state = session.toPublicState(socket.id, watchUserId);
      const response = inProgress
        ? {
            ok: true,
            watchingOnly: true,
            gameStatus: session.getPublicGameStatus(),
            selectionLocked: true,
            gameInProgress: session.status === 'calling',
            hasActiveGame: true,
            canRejoin: false,
            ...session.buildActiveGameSyncPayload(socket.id, watchUserId),
          }
        : {
            ok: true,
            watchingOnly: true,
            gameStatus: session.getPublicGameStatus(),
            selectionLocked: true,
            gameInProgress: session.status === 'calling',
            hasActiveGame: inProgress,
            canRejoin: false,
            ...state,
          };

      if (inProgress) {
        session.emitActiveGameSync(io, socket, watchUserId);
        if (session.status === 'calling') {
          session.ensureBallCaller(io);
        }
        await deliverEndedGameWinnerToSocket(session, io, socket, 'game:watch');
      }

      if (typeof ack === 'function') ack(response);
      if (!inProgress) {
        socket.emit('game:joined', response);
      }
    });

    socket.on('game:start', (payload = {}, ack) => {
      const gameId = payload.gameId || socket.data.gameId;
      const session = gameManager.resolveGameplaySession(gameId);

      if (!session) {
        const err = { ok: false, error: 'Game not found' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const forceStart = payload.forceStart === true;
      const canStart =
        forceStart
          ? typeof session.hasMinimumCartelasToStart === 'function'
            ? session.hasMinimumCartelasToStart()
            : session.getTotalSelectedCartelas() >= MIN_TOTAL_CARTELAS_TO_START
          : session.canStartCalling();

      if (!canStart) {
        const err = {
          ok: false,
          error: `Need at least ${MIN_TOTAL_CARTELAS_TO_START} cartelas selected in the lobby to start`,
        };
        if (typeof ack === 'function') ack(err);
        socket.emit('game:error', err);
        return;
      }

      const startUserId = resolveUserId(socket, payload);
      const startResult = chargeAndStartSession(session, io, { forceStart });
      if (!startResult.ok) {
        const err = { ok: false, error: startResult.error, ...startResult };
        if (typeof ack === 'function') ack(err);
        socket.emit('game:error', err);
        emitWalletSnapshot(socket, getOrInitWallet(startUserId));
        return;
      }

      const state = session.toPublicState(socket.id);
      if (typeof ack === 'function') ack({ ok: true, ...state });
      session.emitPerPlayer(io, 'game:started');
    });

    socket.on('game:state', async (payload = {}, ack) => {
      const gameId = payload.gameId || socket.data.gameId;
      const session = gameManager.resolveGameplaySession(gameId);
      const stateUserId = resolveUserId(socket, payload);

      if (!session) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Game not found' });
        return;
      }

      const inProgress =
        session.status === 'calling' ||
        (session.status === 'ended' && session.resetTimer);

      if (inProgress) {
        socket.join(session.roomName);
        socket.data.gameId = session.gameId;
      }

      const state = inProgress
        ? session.buildActiveGameSyncPayload(socket.id, stateUserId)
        : {
            ok: true,
            gameId: session.gameId,
            gameStatus: session.getPublicGameStatus(),
            ...session.toPublicState(socket.id, stateUserId),
          };

      socket.emit('game:state', state);
      if (typeof ack === 'function') ack(state);

      if (session.status === 'ended' && session.winner) {
        await deliverEndedGameWinnerToSocket(session, io, socket, 'game:state', {
          includeAudio: false,
        });
      }
    });

    socket.on('game:bingo', async (payload = {}, ack) => {
      const gameId = payload.gameId || socket.data.gameId;
      const session = gameManager.getSession(gameId);

      if (!session) {
        const err = { ok: false, error: 'Game not found' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      if (session.status === 'ended') {
        const winnerPayload =
          session.winnerDisplayPayload ??
          (await session.buildWinnerAnnouncementPayloadForDisplay(session.winner));
        if (typeof ack === 'function') {
          ack({
            ok: true,
            alreadyEnded: true,
            ...(winnerPayload ?? {}),
          });
        }
        if (winnerPayload) {
          await deliverEndedGameWinnerToSocket(session, io, socket, 'game:bingo-already-ended');
        }
        return;
      }

      const cartelId = Number(payload.cartelId ?? payload.primaryCartelId);
      if (!Number.isInteger(cartelId) || cartelId < 1) {
        const err = { ok: false, error: 'Invalid cartel' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const player = session.players.get(socket.id);
      if (!player?.cartelIds?.includes(cartelId)) {
        const err = { ok: false, error: 'No Bingo' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const { validateBingoClaim } = require('./utils/bingoWin');
      const cartelMarks =
        player.manualMarks?.[String(cartelId)] ??
        player.manualMarks?.[cartelId] ??
        [];
      const isValid = validateBingoClaim(
        cartelId,
        session.calledNumbers,
        cartelMarks,
        player.automatic
      );

      if (!isValid) {
        const err = { ok: false, error: 'No Bingo' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const primaryCartelId = cartelId;

      const winnerPayload =
        (await session.declareWinner(io, {
          socketId: socket.id,
          cartelId: primaryCartelId,
          primaryCartelId,
          playerName: payload.playerName || socket.data.playerName,
          winners: payload.winners,
        })) ??
        (await session.buildWinnerAnnouncementPayloadForDisplay({
          socketId: socket.id,
          cartelId: primaryCartelId,
          primaryCartelId,
          winners: payload.winners,
        }));

      const userId = resolveUserId(socket, payload);
      const wallet = getOrInitWallet(userId);
      emitWalletSnapshot(socket, wallet);

      if (typeof ack === 'function') {
        ack({
          ...winnerPayload,
          ...toSnapshot(wallet),
        });
      }
    });

    socket.on('game:leave', (payload = {}, ack) => {
      const gameId = payload.gameId || socket.data.gameId;
      if (!gameId) {
        if (typeof ack === 'function') ack({ ok: true, left: false });
        return;
      }

      const session = gameManager.getSession(gameId);
      if (!session) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Game not found' });
        return;
      }

      const userId = resolveUserId(socket, payload);
      const temporaryLeave = payload.temporary !== false;
      const inProgress =
        session.status === 'calling' ||
        (session.status === 'ended' && session.resetTimer);

      if (temporaryLeave && inProgress) {
        const away = session.markPlayerAway(socket.id);
        if (away?.userId) {
          gameManager.setUserGame(away.userId, session.gameId);
        }
      } else {
        session.removePlayer(socket.id);
        gameManager.clearUserGame(userId);
      }

      socket.leave(session.roomName);
      delete socket.data.gameId;

      emitRoomPlayersChurn(session);

      emitRoomGameUpdate(session, { lightweight: true });

      const response = {
        ok: true,
        left: true,
        temporary: temporaryLeave && inProgress,
        gameId: session.gameId,
        status: session.status,
      };
      if (typeof ack === 'function') ack(response);
    });

    /** Check whether user should rejoin active game or open card selection */
    socket.on('game:player-status', (payload = {}, ack) => {
      const userId = resolveGameplayUserId(socket, payload);
      if (!userId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'telegram_auth_required' });
        }
        return;
      }
      socket.data.userId = userId;
      socket.data.telegramUserId = userId;
      console.log('[telegram] websocket game:player-status', { userId });

      const lobby = gameManager.getLobbySession();
      const lobbyCartels = lobby.getCartelsForUser(userId);

      const session = gameManager.findRejoinableSession(userId);
      if (session && session.canUserRejoin(userId)) {
        socket.join(session.roomName);
        socket.data.gameId = session.gameId;

        const state = session.toPublicState(null, userId);
        const response = {
          ok: true,
          hasActiveGame: true,
          canRejoin: true,
          watchingOnly: false,
          gameStatus: session.getPublicGameStatus(),
          selectionLocked: session.isSelectionLocked(),
          rejoin: true,
          ...state,
        };
        if (typeof ack === 'function') ack(response);
        return;
      }

      if (lobby.isSelectionLocked() && lobbyCartels.length === 0) {
        socket.join(lobby.roomName);
        socket.data.gameId = lobby.gameId;
        socket.data.watchingOnly = true;

        const state = lobby.toPublicState(null, userId);
        const response = {
          ok: true,
          hasActiveGame: true,
          canRejoin: false,
          watchingOnly: true,
          gameStatus: lobby.getPublicGameStatus(),
          selectionLocked: true,
          gameInProgress: lobby.status === 'calling',
          ...state,
        };
        if (typeof ack === 'function') ack(response);
        return;
      }

      const empty = {
        ok: true,
        hasActiveGame: false,
        canRejoin: false,
        watchingOnly: false,
        gameStatus: lobby.getPublicGameStatus(),
        selectionLocked: lobby.isSelectionLocked(),
        gameInProgress: lobby.status === 'calling',
        ...lobby.toLobbySyncPayload(userId),
      };
      if (typeof ack === 'function') ack(empty);
    });

    /** Reconnect socket to an in-progress game */
    socket.on('game:rejoin', async (payload = {}, ack) => {
      const userId = resolveGameplayUserId(socket, payload);
      if (!userId) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'telegram_auth_required' });
        }
        return;
      }

      const bannedErr = await rejectIfBannedSocket(userId, ack);
      if (bannedErr) return;

      socket.data.userId = userId;
      socket.data.telegramUserId = userId;

      const session =
        gameManager.findRejoinableSession(userId) ||
        (payload.gameId ? gameManager.getSession(payload.gameId) : null);

      if (!session || !session.canUserRejoin(userId)) {
        const err = {
          ok: false,
          hasActiveGame: false,
          canRejoin: false,
          error: 'No active game to rejoin',
          redirectTo: '/card-selection',
        };
        if (typeof ack === 'function') ack(err);
        return;
      }

      const player = session.rejoinPlayer(socket.id, userId);
      if (!player) {
        const err = { ok: false, error: 'Could not restore player session' };
        if (typeof ack === 'function') ack(err);
        return;
      }

      socket.join(session.roomName);
      socket.data.gameId = session.gameId;
      gameManager.setUserGame(userId, session.gameId);

      const response = {
        ...session.buildActiveGameSyncPayload(socket.id, userId),
        rejoined: true,
        hasActiveGame: true,
        canRejoin: true,
        redirectTo: '/main-game',
      };

      session.ensureBallCaller(io);
      if (typeof ack === 'function') ack(response);
      emitRoomGameUpdate(session, { lightweight: true });

      await deliverEndedGameWinnerToSocket(session, io, socket, 'game:rejoin');
    });

    socket.on('game:marks-update', (payload = {}) => {
      const gameId = payload.gameId || socket.data.gameId;
      const session = gameManager.getSession(gameId);
      if (!session) return;

      const userId = resolveUserId(socket, payload);
      session.updatePlayerMarks(userId, payload.manualMarks, payload.automatic);
    });

    socket.on('disconnect', () => {
      const gameId = socket.data.gameId;
      if (!gameId) return;

      const session = gameManager.getSession(gameId);
      if (!session) return;

      const userId = socket.data.userId;
      const inProgress =
        session.status === 'calling' ||
        (session.status === 'ended' && session.resetTimer);

      if (inProgress) {
        const away = session.markPlayerAway(socket.id);
        if (away?.userId) {
          gameManager.setUserGame(away.userId, session.gameId);
        }
      } else if (session.status === 'waiting') {
        const seated = session.players.get(socket.id);
        if (seated?.cartelIds?.length) {
          session.markPlayerAway(socket.id);
        } else {
          session.removePlayer(socket.id);
          if (userId) gameManager.clearUserGame(userId);
        }
      } else {
        session.removePlayer(socket.id);
        if (userId) gameManager.clearUserGame(userId);
      }

      emitRoomPlayersChurn(session);
      emitRoomGameUpdate(session, { lightweight: true });

      console.log(`[socket] disconnected ${socket.id} from ${gameId}`);
    });
  });
}

module.exports = { registerSocketHandlers };
