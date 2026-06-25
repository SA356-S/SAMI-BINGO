const settingsService = require('../services/settingsService');
const { generateBingoCard } = require('../utils/bingoCard');
const bingoBall = require('../utils/bingoBall');
const { formatBallCall, getBingoLetter } = bingoBall;
const {
  emitRoomIfChanged,
  clearRoomBroadcastCache,
} = require('./roomBroadcast');
const { runDeferred } = require('../utils/eventLoopDefer');

const DEBUG_BINGO_DRAW = process.env.DEBUG_BINGO_DRAW === 'true';
const {
  BALL_INTERVAL_MS,
  GAME_ENTRY_STAKE,
  HOUSE_COMMISSION_RATE,
  MIN_PLAYERS,
  MAX_CARTELS_PER_PLAYER,
  MIN_TOTAL_CARTELAS_TO_START,
  GAME_ID_PREFIX,
  ID_CHARS,
  ROUND_END_DISPLAY_MS,
  LOBBY_PHASE,
} = require('../config/constants');

/**
 * @typedef {Object} PlayerRecord
 * @property {string} socketId
 * @property {string} [userId]
 * @property {string} playerName
 * @property {number[]} cartelIds
 * @property {{ cartelId: number, grid: (number|null)[][] }[]} cards
 * @property {'active'|'away'} [status]
 * @property {Record<string, string[]>} [manualMarks]
 * @property {boolean} [automatic]
 * @property {number} [leftAt]
 */

/**
 * In-memory 75-ball session — shapes align with frontend REST + future socket clients.
 */
class GameSession {
  constructor(gameId, options = {}) {
    this.gameId = gameId;
    this.stake = options.stake ?? GAME_ENTRY_STAKE;
    /** @type {Map<string, PlayerRecord>} socketId -> player */
    this.players = new Map();
    /** @type {Map<string, PlayerRecord>} userId -> player temporarily away */
    this.awayPlayers = new Map();
    /** cartelId -> userId (or legacy socketId) */
    this.cartelOwners = new Map();
    this.takenCartels = new Set();
    this.calledNumbers = [];
    // 1..75 draw counter for the current round (used for monotonic updates/debugging).
    this.ballSequence = 0;
    this.status = 'waiting';
    this.drawTimer = null;
    this.resetTimer = null;
    // Protect against multiple overlapping draw loops (e.g. multiple start triggers).
    this._drawLoopToken = 0;
    this._ballCallInFlight = false;
    /** Draw requested while previous ball emit was in flight */
    this._ballCallPending = false;
    /** Prevents concurrent startCalling from stacking intervals / invalidating tokens */
    this._ballCallerStarting = false;
    this.winner = null;
    /** Prevents duplicate winner broadcasts / double prize paths */
    this._winnerLocked = false;
    this._humanPrizesDistributed = false;
    this.createdAt = Date.now();
    /** Set when entry fees are collected at game start */
    this.stakesCharged = false;
    this.totalPool = 0;
    this.houseShare = 0;
    this.prizePool = 0;
    /** Server-authoritative lobby countdown end (ms epoch) */
    this.lobbyCountdownEndsAt = null;
    this._lobbyExpiredLatch = false;
    /** WAITING | COUNTDOWN_RUNNING | GAME_STARTED */
    this.lobbyPhase = LOBBY_PHASE.COUNTDOWN_RUNNING;
    /** Fingerprints for deduplicated room-wide Socket.IO emits */
    this._roomBroadcastCache = Object.create(null);
    /** O(1) userId -> seated/away player record */
    this._playersByUserId = new Map();
    this._playersListCache = null;
    this._seatedPlayersCache = null;
    this._seatedCountCache = null;
    this._totalCartelsCache = null;
    this._takenCartelsArrayCache = null;
    /** Monotonic epoch — fingerprint cartela/roster changes without scanning arrays */
    this._roomStateEpoch = 0;
    this._cachedPublicGameStatus = null;
    this._cachedPublicGameStatusKey = null;
    /** Per-second lobby core fields reused across tick payloads */
    this._roomLobbyCoreCache = null;
    this._roomLobbyCoreTick = -1;
    this._lastBallEmitSequence = 0;
  }

  _broadcastOpts(extra = {}) {
    return { stateEpoch: this._roomStateEpoch, ...extra };
  }

  /** Invalidate derived player/lobby caches after cartel or roster mutations. */
  _bumpRoomState() {
    this._roomStateEpoch += 1;
    this._playersListCache = null;
    this._seatedPlayersCache = null;
    this._seatedCountCache = null;
    this._totalCartelsCache = null;
    this._takenCartelsArrayCache = null;
    this._roomLobbyCoreCache = null;
    this._roomLobbyCoreTick = -1;
    this._cachedPublicGameStatus = null;
    this._cachedPublicGameStatusKey = null;
    clearRoomBroadcastCache(this._roomBroadcastCache);
  }

  _indexPlayer(player) {
    if (player?.userId) {
      this._playersByUserId.set(String(player.userId), player);
    }
  }

  _unindexPlayer(userId) {
    if (userId) this._playersByUserId.delete(String(userId));
  }

  getTakenCartelsArray() {
    if (this._takenCartelsArrayCache) return this._takenCartelsArrayCache;
    this._takenCartelsArrayCache = [...this.takenCartels];
    return this._takenCartelsArrayCache;
  }

  getCartelsForUser(userId) {
    if (!userId) return [];
    const player = this.getPlayerByUserId(String(userId));
    return player?.cartelIds?.length ? [...player.cartelIds] : [];
  }

  armLobbyCountdown(seconds) {
    const fallback = settingsService.getCardSelectionTimeSync();
    const duration = Math.max(1, Number(seconds) || fallback);
    this.lobbyCountdownEndsAt = Date.now() + duration * 1000;
    this._lobbyExpiredLatch = false;
    this.lobbyPhase = LOBBY_PHASE.COUNTDOWN_RUNNING;
  }

  /** Ensure the 45s loop is armed whenever the lobby is waiting (never paused by cartels). */
  ensureLobbyCountdownRunning() {
    if (this.status !== 'waiting') return;
    this.lobbyPhase = LOBBY_PHASE.COUNTDOWN_RUNNING;
    if (!this.lobbyCountdownEndsAt) {
      this.armLobbyCountdown();
    }
  }

  /** Restart the 45 → 0 cycle without affecting cartel selections. */
  restartLobbyCountdownLoop() {
    if (this.status !== 'waiting') return;
    this.armLobbyCountdown(settingsService.getCardSelectionTimeSync());
  }

  /** Total cartelas selected in the lobby (robots + users combined). */
  getTotalSelectedCartelas() {
    return this.takenCartels?.size ?? 0;
  }

  /** Session may start only when at least 2 cartelas are selected in total. */
  hasMinimumCartelasToStart() {
    return this.getTotalSelectedCartelas() >= MIN_TOTAL_CARTELAS_TO_START;
  }

  /** @param {string | null | undefined} userId */
  static isRobotUserId(userId) {
    return String(userId || '').startsWith('robot:');
  }

  /** Cartelas held by seated human players (telegram users). */
  getHumanSelectedCartelas() {
    let total = 0;
    for (const player of this.allSeatedPlayers()) {
      if (GameSession.isRobotUserId(player.userId)) continue;
      total += player.cartelIds?.length ?? 0;
    }
    return total;
  }

  /** Cartelas held by seated robots. */
  getRobotSelectedCartelas() {
    let total = 0;
    for (const player of this.allSeatedPlayers()) {
      if (!GameSession.isRobotUserId(player.userId)) continue;
      total += player.cartelIds?.length ?? 0;
    }
    return total;
  }

  /** Player holds at least one cartela and is seated for the round. */
  playerHasAnyCartelas(player) {
    return (player?.cartelIds?.length ?? 0) >= 1;
  }

  /** @deprecated alias — start gate is session total, not per-player minimum */
  playerHasRequiredCartels(player) {
    return this.playerHasAnyCartelas(player);
  }

  /**
   * Lobby may start when total selected cartelas (robots + users) >= 2.
   * No normal human user is required — robot-only rounds are allowed.
   */
  hasReadyPlayersForStart() {
    return this.hasMinimumCartelasToStart();
  }

  /** True when cartela picking is closed (game running or finished). */
  isSelectionLocked() {
    return (
      this.status === 'calling' ||
      this.status === 'ended' ||
      this.status === 'finished' ||
      this.lobbyPhase === LOBBY_PHASE.GAME_STARTED
    );
  }

  /** Public phase for clients: WAITING | RUNNING | FINISHED */
  getPublicGameStatus() {
    const key = String(this.status ?? 'waiting').toLowerCase();
    if (this._cachedPublicGameStatusKey === key && this._cachedPublicGameStatus) {
      return this._cachedPublicGameStatus;
    }
    let value;
    if (key === 'calling') value = 'RUNNING';
    else if (key === 'ended' || key === 'finished') value = 'FINISHED';
    else value = 'WAITING';
    this._cachedPublicGameStatusKey = key;
    this._cachedPublicGameStatus = value;
    return value;
  }

  /** Shared lobby fields rebuilt at most once per wall-clock second. */
  _getRoomLobbyCore() {
    const tick = Math.floor(Date.now() / 1000);
    if (this._roomLobbyCoreCache && this._roomLobbyCoreTick === tick) {
      return this._roomLobbyCoreCache;
    }
    this._roomLobbyCoreTick = tick;
    this._roomLobbyCoreCache = {
      gameId: this.gameId,
      status: this.status,
      gameStatus: this.getPublicGameStatus(),
      lobbyPhase: this.lobbyPhase,
      phase: this.lobbyPhase,
      countdownSeconds: this.getLobbyCountdownRemaining(),
      countdownEndsAt: this.lobbyCountdownEndsAt,
      serverTime: Date.now(),
      takenCartels: this.getTakenCartelsArray(),
      playersCount: this.playersCount,
      selectionLocked: this.isSelectionLocked(),
      gameInProgress: this.status === 'calling',
    };
    return this._roomLobbyCoreCache;
  }

  /**
   * Broadcast cartela occupancy to everyone in the room.
   * Each client gets their own myCartels/takenByOthers; room payload never leaks another user's selection.
   */
  emitLobbySelectionUpdate(io) {
    const roomPayload = this.buildLobbySelectionPayload();
    emitRoomIfChanged(
      io,
      this.roomName,
      'game:selection-update',
      roomPayload,
      this._roomBroadcastCache,
      'selectionUpdate',
      this._broadcastOpts()
    );
  }

  buildLobbySelectionPayload() {
    return { ...this._getRoomLobbyCore() };
  }

  buildWaitingLobbyTickPayload() {
    return {
      ...this._getRoomLobbyCore(),
      lobbyPhase: LOBBY_PHASE.COUNTDOWN_RUNNING,
      phase: LOBBY_PHASE.COUNTDOWN_RUNNING,
      gameInProgress: false,
    };
  }

  buildCallingLobbyTickPayload() {
    return {
      ...this._getRoomLobbyCore(),
      gameInProgress: true,
      selectionLocked: true,
      status: 'calling',
    };
  }

  emitWaitingLobbyTick(io) {
    emitRoomIfChanged(
      io,
      this.roomName,
      'game:lobby-tick',
      this.buildWaitingLobbyTickPayload(),
      this._roomBroadcastCache,
      'lobbyTickWaiting',
      this._broadcastOpts()
    );
  }

  emitCallingLobbyTick(io) {
    emitRoomIfChanged(
      io,
      this.roomName,
      'game:lobby-tick',
      this.buildCallingLobbyTickPayload(),
      this._roomBroadcastCache,
      'lobbyTickCalling',
      this._broadcastOpts({ ignoreServerTime: true })
    );
  }

  /**
   * Room-wide game:update with optional dedupe for lightweight calling churn.
   * @param {import('socket.io').Server} io
   */
  emitRoomGameUpdate(io, { lightweight = false } = {}) {
    if (!io) return;
    const duringCalling = this.status === 'calling';
    const slim = lightweight && duringCalling;
    const payload = this.toRoomBroadcastState({
      includeBallHistory: !slim,
      includePlayers: !slim,
      includeOwnership: !slim,
    });

    if (slim) {
      emitRoomIfChanged(
        io,
        this.roomName,
        'game:update',
        payload,
        this._roomBroadcastCache,
        'gameUpdateSlim',
        this._broadcastOpts()
      );
      return;
    }

    delete this._roomBroadcastCache.gameUpdateSlim;
    io.to(this.roomName).emit('game:update', payload);
  }

  emitRoomPlayersChurn(io) {
    if (!io) return;
    const duringCalling = this.status === 'calling';
    const payload = {
      gameId: this.gameId,
      playersCount: this.playersCount,
    };
    if (!duringCalling) {
      payload.players = this.buildPlayersList();
    }
    emitRoomIfChanged(
      io,
      this.roomName,
      'game:players',
      payload,
      this._roomBroadcastCache,
      duringCalling ? 'playersSlim' : 'playersFull',
      this._broadcastOpts()
    );
  }

  getLobbyCountdownRemaining() {
    if (!this.lobbyCountdownEndsAt) return settingsService.getCardSelectionTimeSync();
    return Math.max(
      0,
      Math.ceil((this.lobbyCountdownEndsAt - Date.now()) / 1000)
    );
  }

  getTakenByOthers(userId = null) {
    const mine = new Set(userId ? this.getCartelsForUser(userId) : []);
    return [...this.takenCartels].filter((id) => !mine.has(id));
  }

  toLobbySyncPayload(userId = null) {
    const uid = userId ? String(userId) : null;
    const myCartels = uid ? this.getCartelsForUser(uid) : [];
    const payload = {
      ...this._getRoomLobbyCore(),
      myCartels,
      selectedCartels: myCartels,
    };
    if (uid) {
      payload.takenByOthers = this.getTakenByOthers(uid);
    }
    return payload;
  }

  get playersCount() {
    if (this._seatedCountCache != null) return this._seatedCountCache;
    this._seatedCountCache = this.allSeatedPlayers().length;
    return this._seatedCountCache;
  }

  /** "Player 2" when the user selected 2 cartels, etc. */
  static playerLabelFromCartelCount(cartelCount) {
    const n = Math.max(0, Number(cartelCount) || 0);
    return n > 0 ? `Player ${n}` : 'Player';
  }

  /** Unique seated players (at least one cartel) */
  /** All seated players (connected + temporarily away). */
  allSeatedPlayers() {
    if (this._seatedPlayersCache) return this._seatedPlayersCache;

    const byUser = new Map();
    for (const p of this.players.values()) {
      if (p.userId) byUser.set(String(p.userId), p);
      else byUser.set(String(p.socketId), p);
    }
    for (const p of this.awayPlayers.values()) {
      if (p.userId) byUser.set(String(p.userId), p);
    }
    this._seatedPlayersCache = [...byUser.values()].filter((p) => p.cartelIds?.length);
    return this._seatedPlayersCache;
  }

  buildPlayersList() {
    if (this._playersListCache) return this._playersListCache;

    const list = [];
    let seat = 0;

    for (const p of this.allSeatedPlayers()) {
      seat += 1;
      const socketId = String(p.socketId);
      const cartelCount = p.cartelIds.length;
      const fallbackLabel = GameSession.playerLabelFromCartelCount(cartelCount);
      const displayName =
        p.playerName && String(p.playerName).trim()
          ? String(p.playerName).trim()
          : fallbackLabel;

      list.push({
        socketId,
        userId: p.userId,
        playerName: displayName,
        displayName,
        cartelCount,
        seatNumber: seat,
        cartelIds: [...p.cartelIds],
        status: p.status ?? 'active',
      });
    }

    this._playersListCache = list;
    return list;
  }

  getPlayerByUserId(userId) {
    if (!userId) return null;
    const id = String(userId);
    const indexed = this._playersByUserId.get(id);
    if (indexed) return indexed;

    for (const p of this.players.values()) {
      if (String(p.userId) === id) {
        this._indexPlayer(p);
        return p;
      }
    }
    const away = this.awayPlayers.get(id) ?? null;
    if (away) this._indexPlayer(away);
    return away;
  }

  canUserRejoin(userId) {
    const player = this.getPlayerByUserId(userId);
    if (!player?.cartelIds?.length) return false;
    if (this.status === 'calling') return true;
    if (this.status === 'ended' && this.resetTimer) return true;
    return false;
  }

  /**
   * cartelId -> owner metadata for UI labels and client filtering.
   * @param {string|null} forViewerSocketId
   */
  buildCartelOwnership(forViewerSocketId = null, forViewerUserId = null) {
    const ownership = {};
    let seat = 0;

    for (const p of this.allSeatedPlayers()) {
      if (!p.cartelIds?.length) continue;

      seat += 1;
      const socketId = String(p.socketId);
      const ownerKey = String(p.userId ?? p.socketId);
      const cartelCount = p.cartelIds.length;
      const playerLabel = GameSession.playerLabelFromCartelCount(cartelCount);
      const isMine =
        (forViewerUserId != null &&
          p.userId != null &&
          String(p.userId) === String(forViewerUserId)) ||
        (forViewerSocketId != null && socketId === String(forViewerSocketId));

      p.cartelIds.forEach((cartelId, index) => {
        const cartelSlot = index + 1;
        const ownerLabel =
          cartelCount > 1
            ? `${playerLabel} · #${cartelId}`
            : playerLabel;

        ownership[cartelId] = {
          cartelId,
          socketId,
          userId: p.userId,
          playerName: playerLabel,
          playerLabel,
          cartelCount,
          playerSeat: seat,
          cartelSlot,
          isMine,
          ownerLabel,
        };
      });
    }

    return ownership;
  }

  /** Total cartels reserved by all players in this session */
  get totalCartels() {
    if (this._totalCartelsCache != null) return this._totalCartelsCache;
    this._totalCartelsCache = this.allSeatedPlayers().reduce(
      (sum, player) => sum + player.cartelIds.length,
      0
    );
    return this._totalCartelsCache;
  }

  /** Preview pool before start, or settled prize after 20% house cut */
  get derash() {
    if (this.stakesCharged) {
      return Math.max(0, this.prizePool);
    }
    const previewPool = this.totalCartels * this.stake;
    return Math.max(0, Math.floor(previewPool * (1 - HOUSE_COMMISSION_RATE)));
  }

  /** Gross pool before house commission (all cartels × stake) */
  get grossPool() {
    if (this.stakesCharged) {
      return this.totalPool;
    }
    return this.totalCartels * this.stake;
  }

  get latestBall() {
    const len = this.calledNumbers.length;
    return len > 0 ? this.calledNumbers[len - 1] : null;
  }

  isCartelAvailable(cartelId, exceptOwnerKey = null) {
    const id = Number(cartelId);
    if (!Number.isInteger(id) || id < 1 || id > 400) return false;
    if (this.takenCartels.has(id)) {
      const owner = this.cartelOwners.get(id);
      if (
        exceptOwnerKey &&
        owner != null &&
        String(owner) === String(exceptOwnerKey)
      ) {
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Reserve cartels and attach generated 5×5 grids to the player.
   * @returns {{ ok: boolean, cards?: object[], error?: string }}
   */
  assignCartels(socketId, cartelIds, playerName = 'Player', userId = null) {
    const ids = [...new Set(cartelIds.map(Number))].filter((n) => n >= 1 && n <= 400);

    if (this.isSelectionLocked() && ids.length > 0) {
      const resolvedUserId =
        userId != null && userId !== ''
          ? String(userId)
          : this.players.get(socketId)?.userId
            ? String(this.players.get(socketId).userId)
            : null;
      const current = resolvedUserId ? this.getCartelsForUser(resolvedUserId) : [];
      const sameSelection =
        ids.length === current.length && ids.every((id) => current.includes(id));
      if (!sameSelection) {
        return {
          ok: false,
          error: 'game_in_progress',
          selectionLocked: true,
          message: 'Game already started — cartela selection is closed',
        };
      }
    }

    const existing =
      this.players.get(socketId) ??
      (userId != null ? this.awayPlayers.get(String(userId)) : null);
    const resolvedUserId =
      userId != null && userId !== ''
        ? String(userId)
        : existing?.userId
          ? String(existing.userId)
          : null;
    const ownerKey = resolvedUserId ? String(resolvedUserId) : String(socketId);

    /** Deselect all — release this player's reservations */
    if (ids.length === 0) {
      const released = [];
      if (existing?.cartelIds?.length) {
        for (const oldId of existing.cartelIds) {
          const owner = this.cartelOwners.get(oldId);
          if (owner != null && String(owner) === ownerKey) {
            this.takenCartels.delete(oldId);
            this.cartelOwners.delete(oldId);
            released.push(oldId);
          }
        }
      }

      if (existing) {
        this.players.set(socketId, {
          ...existing,
          socketId: String(socketId),
          userId: resolvedUserId,
          playerName: playerName || existing.playerName || String(socketId),
          cartelIds: [],
          cards: [],
          status: 'active',
        });
        if (resolvedUserId) {
          this.awayPlayers.delete(String(resolvedUserId));
        }
      }

      this._bumpRoomState();
      return { ok: true, cards: [], released };
    }

    if (ids.length > MAX_CARTELS_PER_PLAYER) {
      return { ok: false, error: `Maximum ${MAX_CARTELS_PER_PLAYER} cartels per player` };
    }

    for (const id of ids) {
      if (!this.isCartelAvailable(id, ownerKey)) {
        return { ok: false, error: `Cartel ${id} is not available` };
      }
    }

    if (existing) {
      for (const oldId of existing.cartelIds) {
        this.takenCartels.delete(oldId);
        this.cartelOwners.delete(oldId);
      }
    }

    const cards = ids.map((cartelId) => generateBingoCard(cartelId));

    for (const id of ids) {
      this.takenCartels.add(id);
      this.cartelOwners.set(id, ownerKey);
    }

    this.players.set(socketId, {
      socketId: String(socketId),
      userId: resolvedUserId,
      playerName: playerName || existing?.playerName || String(socketId),
      cartelIds: ids,
      cards,
      status: 'active',
      manualMarks: existing?.manualMarks ?? {},
      automatic: existing?.automatic ?? true,
    });

    if (resolvedUserId) {
      this.awayPlayers.delete(String(resolvedUserId));
    }

    const playerRecord = this.players.get(socketId);
    this._indexPlayer(playerRecord);
    this._bumpRoomState();
    return { ok: true, cards };
  }

  updatePlayerMarks(userId, manualMarks, automatic) {
    const player = this.getPlayerByUserId(userId);
    if (!player) return false;
    if (manualMarks && typeof manualMarks === 'object') {
      player.manualMarks = manualMarks;
    }
    if (typeof automatic === 'boolean') {
      player.automatic = automatic;
    }
    return true;
  }

  /**
   * Temporary leave — keep cartels reserved and game state for rejoin.
   * @returns {PlayerRecord|null}
   */
  markPlayerAway(socketId) {
    const player = this.players.get(socketId);
    if (!player) return null;

    const userId = player.userId ? String(player.userId) : null;
    player.status = 'away';
    player.leftAt = Date.now();

    for (const id of player.cartelIds) {
      this.takenCartels.add(id);
      this.cartelOwners.set(id, userId ?? String(socketId));
    }

    if (userId) {
      this.awayPlayers.set(userId, player);
      this._indexPlayer(player);
    }

    this.players.delete(socketId);
    return player;
  }

  /**
   * Reattach socket to an existing in-progress seat.
   * @returns {PlayerRecord|null}
   */
  rejoinPlayer(socketId, userId) {
    const uid = String(userId);
    let player = this.getPlayerByUserId(uid);

    if (!player?.cartelIds?.length) return null;

    player = {
      ...player,
      socketId: String(socketId),
      userId: uid,
      status: 'active',
    };

    this.awayPlayers.delete(uid);
    this.players.set(socketId, player);

    const ownerKey = uid;
    for (const id of player.cartelIds) {
      this.takenCartels.add(id);
      this.cartelOwners.set(id, ownerKey);
    }

    this._indexPlayer(player);
    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    if (player.userId) {
      this.awayPlayers.delete(String(player.userId));
      this._unindexPlayer(player.userId);
    }

    for (const id of player.cartelIds) {
      this.takenCartels.delete(id);
      this.cartelOwners.delete(id);
    }
    this.players.delete(socketId);
    if (player.cartelIds?.length) {
      this._bumpRoomState();
    }
  }

  canStartCalling() {
    return this.hasReadyPlayersForStart();
  }

  /**
   * Draw and broadcast the next ball (alias: callNextBall).
   * @param {import('socket.io').Server} io
   */
  callNextBall(io, token = null) {
    // Never allow stale intervals to keep emitting after a new loop starts.
    if (token != null && this._drawLoopToken !== token) return;
    if (this.status !== 'calling' || this.resetTimer) return;
    if (this._ballCallInFlight) {
      this._ballCallPending = true;
      return;
    }
    this._ballCallInFlight = true;
    try {

    const calledSet = new Set(this.calledNumbers);
    const next = bingoBall.drawNextBall(calledSet);

    if (next == null) {
      this.stopCalling();
      io.to(this.roomName).emit(
        'game:finished',
        this.toBallPayload(this.latestBall, { includeHistory: false })
      );
      console.log(`[game] all balls called gameId=${this.gameId}`);
      this.finishRoundWithoutWinner(io);
      return;
    }

    this.calledNumbers.push(next);
    this.ballSequence += 1;
    const payload = this.toBallPayload(next);

    console.info('[bingo-draw] drawn number', {
      gameId: this.gameId,
      number: next,
      sequence: this.ballSequence,
      calledCount: this.calledNumbers.length,
    });
    if (DEBUG_BINGO_DRAW) {
      console.info('[bingo-draw] number sent to clients', {
        gameId: this.gameId,
        event: 'newNumber',
        number: payload.number,
        latestBall: payload.latestBall,
        ballSync: payload.ballSync,
      });
    }

    io.to(this.roomName).emit('newNumber', payload);
    this._emitBallCalledAudio(io, payload);

    const sessionRef = this;
    const drawnNumber = next;
    runDeferred(() => {
      try {
        const { emitNewNumber, emitGameStatus } = require('../services/adminService');
        emitNewNumber(sessionRef, drawnNumber);
        emitGameStatus(sessionRef);
      } catch {
        /* admin optional */
      }

      if (sessionRef.status === 'calling' && !sessionRef.resetTimer) {
        try {
          const { evaluateRobotsAfterBallDraw } = require('../services/robotEngine');
          evaluateRobotsAfterBallDraw(io, sessionRef);
        } catch {
          /* robot win hook optional */
        }
      }
    });

    if (!DEBUG_BINGO_DRAW) {
      console.log(
        `[game] ball:called gameId=${this.gameId} ${formatBallCall(next)} seq=${this.ballSequence}`
      );
    }
    } finally {
      this._ballCallInFlight = false;
      if (this._ballCallPending) {
        this._ballCallPending = false;
        setImmediate(() => {
          if (this.status === 'calling' && !this.resetTimer) {
            this.callNextBall(io, token);
          }
        });
      }
    }
  }

  /**
   * Idempotent — never stack intervals or invalidate a healthy running loop.
   * @param {import('socket.io').Server} io
   * @returns {{ ok: boolean, error?: string, alreadyRunning?: boolean, resumed?: boolean }}
   */
  ensureBallCaller(io) {
    if (this.status === 'calling' && this.drawTimer) {
      return { ok: true, alreadyRunning: true };
    }
    if (this.status === 'calling' && !this.drawTimer) {
      return this.resumeBallCaller(io);
    }
    return this.startCalling(io, { forceStart: true });
  }

  /**
   * Re-attach the draw interval without bumping the loop token (avoids freezing callers).
   * @param {import('socket.io').Server} io
   */
  resumeBallCaller(io) {
    if (this.status !== 'calling' || this.resetTimer) {
      return { ok: false, error: 'Game is not in calling state' };
    }
    if (this.drawTimer) {
      return { ok: true, alreadyRunning: true };
    }

    const loopToken = this._drawLoopToken || 1;
    console.warn(
      `[game] resuming ball caller gameId=${this.gameId} token=${loopToken} called=${this.calledNumbers.length}`
    );

    this.drawTimer = setInterval(() => {
      this.callNextBall(io, loopToken);
    }, BALL_INTERVAL_MS);

    return { ok: true, resumed: true };
  }

  /**
   * Begin the 75-ball draw loop (every BALL_INTERVAL_MS).
   * @param {import('socket.io').Server} io
   * @param {{ forceStart?: boolean }} [options]
   * @returns {{ ok: boolean, error?: string, alreadyRunning?: boolean, resumed?: boolean }}
   */
  startCalling(io, options = {}) {
    const lobby = gameManager.getLobbySession();
    if (this !== lobby) {
      gameManager.stopOrphanBallCallers(lobby.gameId);
      return lobby.ensureBallCaller(io);
    }

    if (this.status === 'calling' && this.drawTimer) {
      return { ok: true, alreadyRunning: true };
    }
    if (this.status === 'calling' && !this.drawTimer) {
      return this.resumeBallCaller(io);
    }
    if (this._ballCallerStarting) {
      return { ok: true, alreadyRunning: true };
    }

    const forceStart = options.forceStart === true;
    const canStart = forceStart
      ? this.hasReadyPlayersForStart()
      : this.canStartCalling();

    if (!canStart) {
      console.warn(
        `[game] cannot start calling gameId=${this.gameId} players=${this.playersCount} force=${forceStart}`
      );
      return { ok: false, error: 'Cannot start game yet' };
    }

    this._ballCallerStarting = true;
    try {
      if (this.drawTimer) {
        clearInterval(this.drawTimer);
        this.drawTimer = null;
      }

      gameManager.stopOrphanBallCallers(this.gameId);
      this.status = 'calling';
      this.lobbyPhase = LOBBY_PHASE.GAME_STARTED;
      this._bumpRoomState();
      this._drawLoopToken += 1;
      const loopToken = this._drawLoopToken;
      this.emitRoomAudio(io, 'game_start_sound', { status: 'calling' });
      console.log(
        `[game] ball caller started gameId=${this.gameId} interval=${BALL_INTERVAL_MS}ms players=${this.playersCount} token=${loopToken}`
      );

      try {
        const { prepareRobotsForCallingRound } = require('../services/robotEngine');
        prepareRobotsForCallingRound(this);
      } catch {
        /* robot prep optional */
      }

      this.callNextBall(io, loopToken);

      this.drawTimer = setInterval(() => {
        this.callNextBall(io, loopToken);
      }, BALL_INTERVAL_MS);

      try {
        const { emitGameStatus } = require('../services/adminService');
        emitGameStatus(this);
      } catch {
        /* admin optional */
      }

      return { ok: true };
    } finally {
      this._ballCallerStarting = false;
    }
  }

  /** Full in-progress snapshot for a socket that joined mid-round (no loop restart). */
  buildActiveGameSyncPayload(forSocketId = null, forUserId = null) {
    const state = this.toPublicState(forSocketId, forUserId);

    const payload = {
      ok: true,
      gameId: this.gameId,
      status: this.status,
      gameStatus: this.getPublicGameStatus(),
      lobbyPhase: this.lobbyPhase,
      phase: this.lobbyPhase,
      selectionLocked: this.isSelectionLocked(),
      gameInProgress: this.status === 'calling',
      alreadyStarted: true,
      syncMode: 'snapshot',
      ...state,
      ...this.toBallPayload(this.latestBall, { includeHistory: true, ballSync: 'snapshot' }),
    };

    if (this.status === 'ended' && this.winner) {
      payload.gameWon = true;
      payload.winnerAnnouncement =
        this.winnerDisplayPayload ??
        this.buildWinnerAnnouncementPayload(this.winner);
    }

    return payload;
  }

  /**
   * Push current round state to one socket — used when players join during RUNNING.
   * @param {import('socket.io').Server} io
   */
  emitActiveGameSync(io, socket, forUserId = null) {
    if (!socket) return;
    const payload = this.buildActiveGameSyncPayload(socket.id, forUserId);
    socket.emit('game:sync', payload);
    socket.emit('game:joined', payload);
  }

  stopCalling() {
    if (this.drawTimer) {
      clearInterval(this.drawTimer);
      this.drawTimer = null;
    }
    if (this.status === 'calling') {
      this.status = 'finished';
    }
  }

  /**
   * End the round when all balls have been drawn and nobody wins.
   * This prevents "stuck" rounds where the UI keeps waiting for a reset.
   */
  finishRoundWithoutWinner(io) {
    // Already in end/reset flow.
    if (this.resetTimer) return;

    if (this.stakesCharged && !this._dailyProfitRecorded) {
      try {
        const { recordCompletedGameProfit } = require('../services/dailyProfitService');
        recordCompletedGameProfit(this, { totalPayouts: 0 }).catch((err) =>
          console.warn('[daily-profit] record failed', err?.message || err)
        );
      } catch {
        /* analytics optional */
      }
    }

    this.clearResetTimer();
    this.status = 'ended';
    this._bumpRoomState();
    this.winner = null;

    this.resetTimer = setTimeout(() => {
      this.resetForNewRound();

      const resetPayload = this.toResetPayload();
      io.to(this.roomName).emit('game:reset', resetPayload);
      io.to(this.roomName).emit('game:redirect', resetPayload);
      io.to(this.roomName).emit('game:lobby-tick', this.toLobbySyncPayload());
      io.to(this.roomName).emit('game:selection-update', {
        ...this.toLobbySyncPayload(),
        takenCartels: [],
        selectedCartels: [],
        playersCount: this.playersCount,
        clearSelections: true,
      });

      console.log(
        `[game] game:reset emitted (no-winner) gameId=${this.gameId} after ${ROUND_END_DISPLAY_MS}ms`
      );
      this.resetTimer = null;
    }, ROUND_END_DISPLAY_MS);
  }

  clearResetTimer() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Build winner splash payload (display names, prize, winning cartel, called balls).
   */
  buildWinnerAnnouncementPayload(winnerInfo = {}) {
    let primaryCartelId = Number(
      winnerInfo.primaryCartelId ?? winnerInfo.cartelId
    );
    const player = winnerInfo.socketId
      ? this.players.get(winnerInfo.socketId)
      : null;
    const prizePool = Math.floor(Math.max(0, Number(this.derash) || 0));
    const humanWinnerCount = Math.max(
      0,
      Number(winnerInfo.humanWinnerCount) ||
        (Array.isArray(winnerInfo.winners)
          ? winnerInfo.winners.filter((w) => w.userId).length
          : 0)
    );
    const { computePrizeSharePerWinner } = require('../services/prizeDistributionService');
    const prizeSharePerWinner =
      humanWinnerCount <= 1
        ? prizePool
        : Math.floor(
            Number(winnerInfo.prizeSharePerWinner) ||
              computePrizeSharePerWinner(prizePool, humanWinnerCount)
          );
    const prize =
      humanWinnerCount > 1 ? prizeSharePerWinner : prizePool;

    const fallbackName = String(
      winnerInfo.playerName || player?.playerName || ''
    ).trim();

    let winners = Array.isArray(winnerInfo.winners) ? [...winnerInfo.winners] : [];
    if (winners.length === 0) {
      winners = [
        {
          playerName: fallbackName || 'Player',
          cartelId: primaryCartelId,
          userId: player?.userId ?? winnerInfo.userId ?? null,
        },
      ];
    } else {
      winners = winners.map((w) => ({
        ...w,
        playerName: String(w.playerName || fallbackName || 'Player').trim(),
        cartelId: Number(w.cartelId),
        prize:
          w.prize != null
            ? Math.floor(Number(w.prize) || 0)
            : humanWinnerCount > 1
              ? prizeSharePerWinner
              : prizePool,
      }));
    }

    const primaryWinner =
      winners.find((w) => Number(w.cartelId) === primaryCartelId) ?? winners[0];
    if (!Number.isInteger(primaryCartelId) || primaryCartelId < 1) {
      const fallbackCartelId = Number(primaryWinner?.cartelId);
      if (Number.isInteger(fallbackCartelId) && fallbackCartelId > 0) {
        primaryCartelId = fallbackCartelId;
      }
    }
    const winnerLabel = String(primaryWinner?.playerName || fallbackName || 'Player');

    return {
      gameId: this.gameId,
      ok: true,
      status: 'ended',
      winners,
      primaryCartelId,
      cartelId: primaryCartelId,
      winnerLabel,
      playerName: winnerLabel,
      playerLabel: winnerLabel,
      prize,
      prizePool,
      prizeSharePerWinner,
      humanWinnerCount,
      derash: prizePool,
      pot: prizePool,
      calledNumbers: [...this.calledNumbers],
      calledHistory: [...this.calledNumbers],
      displaySeconds: ROUND_END_DISPLAY_MS / 1000,
      redirectTo: '/card-selection',
    };
  }

  countConnectedRoomClients(io) {
    const room = io?.sockets?.adapter?.rooms?.get(this.roomName);
    return room ? room.size : 0;
  }

  /**
   * Broadcast winner splash + synchronized bingo audio to every socket in the room.
   */
  broadcastWinnerAnnouncement(io, enrichedPayload, meta = {}) {
    if (!io || !enrichedPayload) return 0;

    const recipientCount = this.countConnectedRoomClients(io);
    const winnerUserId =
      meta.winnerUserId ??
      enrichedPayload?.winners?.[0]?.userId ??
      enrichedPayload?.userId ??
      null;

    console.info('[game][bingo-announce] Winner detected', {
      gameId: this.gameId,
      roomId: this.roomName,
      winnerUserId,
      winnerSocketId: meta.winnerSocketId ?? null,
      primaryCartelId: enrichedPayload.primaryCartelId,
      winnerLabel: enrichedPayload.winnerLabel,
      recipientCount,
      trigger: meta.trigger ?? 'declareWinner',
    });

    this.emitRoomAudio(io, 'bingo_announce', {
      primaryCartelId: enrichedPayload.primaryCartelId,
      cartelId: enrichedPayload.primaryCartelId,
    });
    io.to(this.roomName).emit('game:winner', enrichedPayload);
    io.to(this.roomName).emit('game:over', enrichedPayload);
    io.to(this.roomName).emit('game:ended', enrichedPayload);

    console.info('[game][bingo-announce] Bingo announcement sent', {
      gameId: this.gameId,
      roomId: this.roomName,
      winnerUserId,
      recipientCount,
      events: ['bingo_announce', 'game:winner', 'game:over', 'game:ended'],
    });

    return recipientCount;
  }

  /**
   * Bingo validated — broadcast winner splash, then reset room after 6 seconds.
   */
  async declareWinner(io, winnerInfo = {}) {
    if (this.status === 'ended' && this.winner) {
      return this.buildWinnerAnnouncementPayloadForDisplay(this.winner);
    }
    if (this._winnerLocked) {
      return this.winner
        ? this.buildWinnerAnnouncementPayloadForDisplay(this.winner)
        : null;
    }
    this._winnerLocked = true;

    this.stopCalling();
    this.clearResetTimer();
    this.status = 'ended';
    this._bumpRoomState();

    const {
      distributeHumanPrizesAtWinMoment,
    } = require('../services/prizeDistributionService');
    const prizeResult = distributeHumanPrizesAtWinMoment(this, io);
    this._humanPrizesDistributed = prizeResult.totalPaid > 0;

    const mergedWinnerInfo = {
      ...winnerInfo,
      humanWinnerCount: prizeResult.humanWinnerCount,
      humanWinnerIds: prizeResult.humanWinnerIds,
      prizeSharePerWinner: prizeResult.prizeSharePerWinner,
      prizePool: prizeResult.prizePool,
      winners:
        prizeResult.humanWinnerCount > 0
          ? prizeResult.winners
          : winnerInfo.winners,
    };

    this.winner = mergedWinnerInfo;

    const winnerPayload = this.buildWinnerAnnouncementPayload(mergedWinnerInfo);
    const primaryCartelId = winnerPayload.primaryCartelId;

    let enrichedPayload = winnerPayload;
    try {
      const { enrichWinnerAnnouncementDisplay } = require('../services/playerDisplayNameService');
      enrichedPayload = await enrichWinnerAnnouncementDisplay(this, winnerPayload);
    } catch (err) {
      console.warn('[game] winner display name resolve failed', err?.message);
    }

    console.log(
      `[game] bingo winner gameId=${this.gameId} cartel=${primaryCartelId} label=${enrichedPayload.winnerLabel} prizePool=${enrichedPayload.prizePool} humanWinners=${prizeResult.humanWinnerCount} share=${prizeResult.prizeSharePerWinner} resetIn=${ROUND_END_DISPLAY_MS}ms`
    );

    runDeferred(() => {
      try {
        const { recordRoundOutcome } = require('../services/statsService');
        recordRoundOutcome(this, mergedWinnerInfo).catch((err) =>
          console.warn('[stats] recordRoundOutcome failed', err.message)
        );
        const { recordCompletedGameProfit } = require('../services/dailyProfitService');
        recordCompletedGameProfit(this, { totalPayouts: prizeResult.totalPaid }).catch(
          (err) => console.warn('[daily-profit] record failed', err?.message || err)
        );
        io.emit('stats:update', { gameId: this.gameId });
      } catch {
        /* stats optional */
      }
    });

    this.winnerDisplayPayload = enrichedPayload;

    const winnerPlayer = winnerInfo.socketId
      ? this.players.get(winnerInfo.socketId)
      : null;
    this.broadcastWinnerAnnouncement(io, enrichedPayload, {
      winnerUserId: winnerPlayer?.userId ?? winnerInfo.userId ?? null,
      winnerSocketId: winnerInfo.socketId ?? null,
      trigger: 'declareWinner',
    });

    this.resetTimer = setTimeout(() => {
      this.resetForNewRound();

      const resetPayload = this.toResetPayload();
      io.to(this.roomName).emit('game:reset', resetPayload);
      io.to(this.roomName).emit('game:redirect', resetPayload);
      io.to(this.roomName).emit('game:lobby-tick', this.toLobbySyncPayload());
      io.to(this.roomName).emit('game:selection-update', {
        ...this.toLobbySyncPayload(),
        takenCartels: [],
        selectedCartels: [],
        playersCount: this.playersCount,
        clearSelections: true,
      });

      console.log(
        `[game] game:reset emitted gameId=${this.gameId} after ${ROUND_END_DISPLAY_MS}ms`
      );
      this.resetTimer = null;
    }, ROUND_END_DISPLAY_MS);

    return enrichedPayload;
  }

  async buildWinnerAnnouncementPayloadForDisplay(winnerInfo = {}) {
    const payload = this.buildWinnerAnnouncementPayload(winnerInfo);
    try {
      const { enrichWinnerAnnouncementDisplay } = require('../services/playerDisplayNameService');
      return await enrichWinnerAnnouncementDisplay(this, payload);
    } catch (err) {
      console.warn('[game] winner display name resolve failed', err?.message);
      return payload;
    }
  }

  /** Release every reserved cartel so the lobby starts clean. */
  clearAllPlayerSelections() {
    for (const player of this.players.values()) {
      player.cartelIds = [];
      player.cards = [];
    }
    this.awayPlayers.clear();
    this.takenCartels.clear();
    this.cartelOwners.clear();
    this._playersByUserId.clear();
    for (const player of this.players.values()) {
      this._indexPlayer(player);
    }
    this._bumpRoomState();
  }

  /** Full lobby reset payload — empty balls/cartels, waiting for next round */
  toResetPayload() {
    return {
      gameId: this.gameId,
      ok: true,
      status: 'waiting',
      lobbyPhase: LOBBY_PHASE.COUNTDOWN_RUNNING,
      phase: LOBBY_PHASE.COUNTDOWN_RUNNING,
      redirectTo: '/card-selection',
      displaySeconds: ROUND_END_DISPLAY_MS / 1000,
      selectedCartels: [],
      cartelIds: [],
      myCartels: [],
      cards: [],
      myCards: [],
      calledNumbers: [],
      calledHistory: [],
      called: [],
      balls: [],
      latestBall: null,
      takenCartels: [],
      cartelOwnership: {},
      derash: this.derash,
      pot: this.derash,
      playersCount: this.playersCount,
      clearGame: true,
    };
  }

  /** Clear round state and all cartel selections for the next lobby phase */
  resetForNewRound() {
    this.clearResetTimer();
    if (this.drawTimer) {
      clearInterval(this.drawTimer);
      this.drawTimer = null;
    }
    this.calledNumbers = [];
    this.ballSequence = 0;
    this._lastBallEmitSequence = 0;
    this.winner = null;
    this.winnerDisplayPayload = null;
    this._winnerLocked = false;
    this._humanPrizesDistributed = false;
    this.status = 'waiting';
    this.stakesCharged = false;
    this.totalPool = 0;
    this.houseShare = 0;
    this.prizePool = 0;
    this.clearAllPlayerSelections();
    gameManager.clearSessionUserMappings(this.gameId);
    this.restartLobbyCountdownLoop();
  }

  get roomName() {
    return `game:${this.gameId}`;
  }

  /** Synchronized audio cue — every client in the room receives the same event. */
  emitRoomAudio(io, eventName, payload = {}) {
    if (!io || !eventName) return;
    io.to(this.roomName).emit(eventName, {
      gameId: this.gameId,
      serverTime: Date.now(),
      ...payload,
    });
  }

  /** ball_called audio — always tied to ball sequence (never dedupe across draws). */
  _emitBallCalledAudio(io, ballPayload) {
    if (!io || !ballPayload) return;
    if (this._lastBallEmitSequence === ballPayload.sequence) return;
    this._lastBallEmitSequence = ballPayload.sequence;
    this.emitRoomAudio(io, 'ball_called', {
      number: ballPayload.number,
      sequence: ballPayload.sequence,
      calledCount: ballPayload.calledCount,
      label: ballPayload.label,
      letter: ballPayload.letter,
      ballSync: 'live',
    });
  }

  toBallPayload(number = this.latestBall, { includeHistory = false, ballSync = null } = {}) {
    const base = {
      gameId: this.gameId,
      number,
      letter: getBingoLetter(number),
      label: formatBallCall(number),
      latestBall: this.latestBall,
      calledCount: this.calledNumbers.length,
      sequence: this.ballSequence,
      ballSync: ballSync ?? (includeHistory ? 'snapshot' : 'live'),
    };

    if (!includeHistory) return base;

    return {
      ...base,
      syncMode: 'snapshot',
      calledNumbers: [...this.calledNumbers],
      calledHistory: [...this.calledNumbers],
      called: [...this.calledNumbers],
      balls: [...this.calledNumbers],
    };
  }

  /**
   * Shared fields for room-wide broadcasts (no single-player cartel data).
   * @param {{ includeBallHistory?: boolean, includePlayers?: boolean, includeOwnership?: boolean }} [options]
   */
  toRoomBroadcastState(options = {}) {
    const {
      includeBallHistory = true,
      includePlayers = true,
      includeOwnership = true,
    } = options;

    const playersList = includePlayers ? this.buildPlayersList() : null;

    const base = {
      gameId: this.gameId,
      stake: this.stake,
      bet: this.stake,
      totalCards: this.totalCartels,
      playersCount: includePlayers ? playersList.length : this.playersCount,
      derash: this.derash,
      pot: this.derash,
      totalPool: this.grossPool,
      houseShare: this.stakesCharged
        ? this.houseShare
        : Math.floor(this.grossPool * HOUSE_COMMISSION_RATE),
      grossPool: this.grossPool,
      latestBall: this.latestBall,
      calledCount: this.calledNumbers.length,
      sequence: this.ballSequence,
      takenCartels: this.getTakenCartelsArray(),
      status: this.status,
    };

    if (includePlayers) {
      base.players = playersList;
    }

    if (includeBallHistory) {
      base.calledNumbers = [...this.calledNumbers];
      base.called = [...this.calledNumbers];
      base.balls = [...this.calledNumbers];
    }

    if (includeOwnership) {
      base.cartelOwnership = this.buildCartelOwnership();
    }

    return base;
  }

  /** Per-socket view — includes only that connection's cartels/cards. */
  toPublicState(forSocketId = null, forUserId = null, options = {}) {
    let player = forSocketId ? this.players.get(forSocketId) : null;
    if (!player && forUserId) {
      player = this.getPlayerByUserId(forUserId);
    }
    const viewerUserId = forUserId ?? player?.userId ?? null;
    const playersList = options.playersList ?? this.buildPlayersList();
    const cartelOwnership = this.buildCartelOwnership(
      forSocketId,
      viewerUserId
    );
    const myCartelCount = player?.cartelIds?.length ?? 0;
    const playerLabel = GameSession.playerLabelFromCartelCount(myCartelCount);

    return {
      gameId: this.gameId,
      stake: this.stake,
      bet: this.stake,
      socketId: forSocketId ?? undefined,
      userId: player?.userId,
      myCartelCount,
      playerLabel,
      totalCards: this.totalCartels,
      playersCount: playersList.length,
      players: playersList,
      derash: this.derash,
      pot: this.derash,
      totalPool: this.grossPool,
      houseShare: this.stakesCharged
        ? this.houseShare
        : Math.floor(this.grossPool * HOUSE_COMMISSION_RATE),
      grossPool: this.grossPool,
      calledNumbers: [...this.calledNumbers],
      called: [...this.calledNumbers],
      balls: [...this.calledNumbers],
      latestBall: this.latestBall,
      takenCartels: this.getTakenCartelsArray(),
      status: this.status,
      myCartels: player?.cartelIds ?? [],
      myCards: player?.cards ?? [],
      selectedCartels: player?.cartelIds ?? [],
      cards: player?.cards ?? [],
      cartelOwnership,
      manualMarks: player?.manualMarks ?? {},
      automatic: player?.automatic ?? true,
      playerStatus: player?.status ?? 'active',
      canRejoin: viewerUserId ? this.canUserRejoin(viewerUserId) : false,
      hasActiveGame: viewerUserId ? this.canUserRejoin(viewerUserId) : false,
      rejoin: Boolean(forSocketId && player),
    };
  }

  /** Emit an event with per-socket payloads so each client gets its own cartels. */
  emitPerPlayer(io, eventName, extra = {}) {
    const playersList = this.buildPlayersList();
    const calledNumbers = this.calledNumbers;
    const takenCartels = this.getTakenCartelsArray();

    for (const [socketId] of this.players) {
      const sock = io.sockets.sockets.get(socketId);
      if (sock) {
        const state = this.toPublicState(socketId, null, { playersList });
        state.calledNumbers = [...calledNumbers];
        state.called = state.calledNumbers;
        state.balls = state.calledNumbers;
        state.takenCartels = takenCartels;
        sock.emit(eventName, {
          ok: true,
          gameId: this.gameId,
          ...state,
          ...extra,
        });
      }
    }
  }

  /** REST GET /api/game/card-selection (lobby-wide view for this session) */
  toCardSelectionPayload(wallets = { main: 0, play: 0 }, userId = null) {
    const main = Math.max(0, Number(wallets.main) || 0);
    const play = Math.max(0, Number(wallets.play) || 0);
    const myCartels = userId ? this.getCartelsForUser(userId) : [];
    const lobby = this.toLobbySyncPayload(userId);
    return {
      mainWallet: main,
      playWallet: play,
      totalWalletBalance: main + play,
      wallets: { main, play, total: main + play },
      playersCount: this.playersCount,
      players: this.playersCount,
      takenCartels: this.getTakenCartelsArray(),
      takenByOthers: userId ? this.getTakenByOthers(userId) : [...this.takenCartels],
      taken: [...this.takenCartels],
      occupied: [...this.takenCartels],
      gameId: this.gameId,
      myCartels,
      selectedCartels: myCartels,
      countdownSeconds: lobby.countdownSeconds,
      cardSelectionTime: settingsService.getCardSelectionTimeSync(),
      countdownEndsAt: lobby.countdownEndsAt,
      serverTime: lobby.serverTime,
      status: this.status,
      gameStatus: this.getPublicGameStatus(),
      lobbyPhase: this.lobbyPhase,
      phase: this.lobbyPhase,
      selectionLocked: this.isSelectionLocked(),
      gameInProgress: this.status === 'calling',
      watchingOnly:
        Boolean(userId) &&
        this.isSelectionLocked() &&
        myCartels.length === 0,
    };
  }

  handleLobbyCountdownExpired(io) {
    if (this.status !== 'waiting') return;

    try {
      const { ensureRobotsJoinBeforeRoundStart } = require('../services/robotGameSessionBridge');
      const { getRuntimeMap } = require('../services/robotEngine');
      ensureRobotsJoinBeforeRoundStart(io, this, getRuntimeMap());
    } catch (err) {
      console.warn('[lobby] pre-start robot sync failed', err?.message || err);
    }

    const totalCartelas = this.getTotalSelectedCartelas();
    if (totalCartelas >= MIN_TOTAL_CARTELAS_TO_START) {
      const started = this.tryStartLobbyGame(io, { fromCountdownExpiry: true });
      if (started) return;
    }

    this.restartLobbyCountdownLoop();
  }

  /**
   * Charge stakes and begin calling when the session has at least 2 total cartelas.
   * @returns {boolean} true when the round entered calling state
   */
  tryStartLobbyGame(io, options = {}) {
    if (this.status !== 'waiting') return false;
    const fromCountdownExpiry = options.fromCountdownExpiry === true;
    if (!fromCountdownExpiry && this.getLobbyCountdownRemaining() > 0) return false;
    if (!this.hasMinimumCartelasToStart()) return false;

    const ready = this.allSeatedPlayers().filter((p) => this.playerHasAnyCartelas(p));

    const { chargeAndStartSession } = require('../socket/walletManager');
    const startResult = chargeAndStartSession(this, io, { forceStart: true });

    if (!startResult.ok) {
      console.warn('[lobby] game start failed', startResult.error);

      if (
        startResult.userId &&
        String(startResult.error ?? '').toLowerCase().includes('insufficient')
      ) {
        const player = this.getPlayerByUserId(startResult.userId);
        if (player) {
          this.assignCartels(
            player.socketId,
            [],
            player.playerName,
            startResult.userId
          );
          const sock = io.sockets.sockets.get(player.socketId);
          if (sock) {
            const { getOrInitWallet, emitWalletSnapshot } = require('./walletManager');
            emitWalletSnapshot(sock, getOrInitWallet(startResult.userId));
            sock.emit('game:error', {
              ok: false,
              error: 'insufficient_balance',
              message: 'Insufficient balance',
              required: startResult.required,
              available: startResult.available,
            });
          }
        }
        this.emitLobbySelectionUpdate(io);
      }

      return false;
    }

    this.lobbyPhase = LOBBY_PHASE.GAME_STARTED;

    for (const p of ready) {
      if (p.userId) {
        gameManager.setUserGame(p.userId, this.gameId);
      }
    }

    this.emitLobbyGameStarted(io, ready);
    return true;
  }

  emitLobbyGameStarted(io, readyPlayers = []) {
    const baseStart = {
      ok: true,
      gameId: this.gameId,
      lobbyPhase: LOBBY_PHASE.GAME_STARTED,
      phase: LOBBY_PHASE.GAME_STARTED,
      redirectTo: '/main-game',
      status: this.status,
      gameStatus: this.getPublicGameStatus(),
      serverTime: Date.now(),
      selectionLocked: true,
      gameInProgress: true,
    };

    const playersList = this.buildPlayersList();
    const takenCartels = this.getTakenCartelsArray();
    const calledNumbers = this.calledNumbers;

    for (const [socketId, player] of this.players) {
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) continue;

      const uid = player.userId ? String(player.userId) : null;
      const state = this.toPublicState(socketId, uid, { playersList });
      state.calledNumbers = [...calledNumbers];
      state.called = state.calledNumbers;
      state.balls = state.calledNumbers;
      state.takenCartels = takenCartels;

      if (!this.playerHasAnyCartelas(player)) {
        const watchPayload = {
          ...baseStart,
          ...state,
          watchingOnly: true,
          myCartels: [],
          selectedCartels: [],
        };
        sock.emit('game:joined', watchPayload);
        sock.emit('game:started', watchPayload);
        sock.emit('game_start', watchPayload);
        sock.emit('game:start', watchPayload);
        continue;
      }

      const payload = {
        ...baseStart,
        ...state,
      };
      sock.emit('game:joined', payload);
      sock.emit('game:started', payload);
      sock.emit('game_start', payload);
      sock.emit('game:start', payload);
    }

    const roomStart = {
      ...baseStart,
      ...this._getRoomLobbyCore(),
      takenCartels,
      playersCount: this.playersCount,
    };
    io.to(this.roomName).emit('game:started', roomStart);
    io.to(this.roomName).emit('game_start', roomStart);
    io.to(this.roomName).emit('game:start', roomStart);
    io.to(this.roomName).emit('game:lobby-tick', {
      ...roomStart,
      lobbyPhase: LOBBY_PHASE.GAME_STARTED,
      phase: LOBBY_PHASE.GAME_STARTED,
    });

    void readyPlayers;
  }
}

class GameManager {
  constructor() {
    /** @type {Map<string, GameSession>} */
    this.sessions = new Map();
    /** userId -> gameId for in-progress rejoin */
    this.userToGame = new Map();
    /** Default lobby session used before a dedicated game id is created */
    this.lobbySession = this.createSession();
    this.lobbySession.ensureLobbyCountdownRunning();
    this._lobbyClock = null;
  }

  /**
   * Global 1s tick — broadcasts synchronized lobby countdown to all clients.
   */
  startLobbyCountdownClock(io) {
    if (this._lobbyClock) return;

    const tick = () => {
      const session = this.lobbySession;
      if (!session) return;

      if (session.status === 'waiting') {
        session.ensureLobbyCountdownRunning();

        const remaining = session.getLobbyCountdownRemaining();
        session.emitWaitingLobbyTick(io);

        if (remaining > 0 && remaining <= 5) {
          session.emitRoomAudio(io, 'countdown_tick', { seconds: remaining });
        }

        if (remaining <= 0 && !session._lobbyExpiredLatch) {
          session._lobbyExpiredLatch = true;
          runDeferred(() => session.handleLobbyCountdownExpired(io));
        } else if (remaining > 0) {
          session._lobbyExpiredLatch = false;
        }
      }

      if (session.status === 'calling') {
        session.ensureBallCaller(io);
        session.emitCallingLobbyTick(io);
      }
    };

    tick();
    this._lobbyClock = setInterval(tick, 1000);
  }

  setUserGame(userId, gameId) {
    if (!userId || !gameId) return;
    this.userToGame.set(String(userId), String(gameId));
  }

  clearUserGame(userId) {
    if (!userId) return;
    this.userToGame.delete(String(userId));
  }

  findRejoinableSession(userId) {
    if (!userId) return null;

    const mappedId = this.userToGame.get(String(userId));
    if (mappedId) {
      const session = this.getSession(mappedId);
      if (session?.canUserRejoin(userId)) return session;
    }

    for (const session of this.sessions.values()) {
      if (session === this.lobbySession) continue;
      if (session.canUserRejoin(userId)) return session;
    }

    return null;
  }

  clearSessionUserMappings(gameId) {
    const gid = String(gameId);
    for (const [userId, id] of this.userToGame.entries()) {
      if (id === gid) this.userToGame.delete(userId);
    }
  }

  /** DB-XXXXXXXX — matches MainGame.jsx */
  generateGameId() {
    let suffix = '';
    for (let i = 0; i < 8; i += 1) {
      suffix += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    }
    return `${GAME_ID_PREFIX}${suffix}`;
  }

  /**
   * Compact alphanumeric id (e.g. DB5W9XN8) without hyphen — optional display variant.
   */
  generateCompactGameId() {
    let id = 'DB';
    for (let i = 0; i < 6; i += 1) {
      id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    }
    return id;
  }

  createSession(gameId = null, options = {}) {
    const id = gameId || this.generateGameId();
    if (this.sessions.has(id)) {
      return this.sessions.get(id);
    }
    const session = new GameSession(id, options);
    this.sessions.set(id, session);
    return session;
  }

  getSession(gameId) {
    if (!gameId) return this.lobbySession;
    return this.sessions.get(gameId) || null;
  }

  getOrCreateSession(gameId) {
    if (!gameId) return this.lobbySession;
    return this.sessions.get(gameId) || this.createSession(gameId);
  }

  /**
   * Resolve gameplay session — never spawn a stray session when the lobby round is live.
   * @param {string|null|undefined} gameId
   */
  resolveGameplaySession(gameId) {
    if (!gameId) return this.lobbySession;

    const id = String(gameId);
    const lobby = this.lobbySession;
    if (id === lobby.gameId) return lobby;

    const existing = this.sessions.get(id);
    if (existing) return existing;

    if (lobby.status === 'calling' || lobby.status === 'ended') {
      return lobby;
    }

    return this.createSession(id);
  }

  /** Active session for card-selection polling (singleton lobby). */
  getLobbySession() {
    return this.lobbySession;
  }

  /** Only the lobby session may run the global ball loop — stop stray intervals. */
  stopOrphanBallCallers(keepGameId = null) {
    const keep = keepGameId ? String(keepGameId) : this.lobbySession?.gameId;
    for (const session of this.sessions.values()) {
      if (!session.drawTimer) continue;
      if (keep && String(session.gameId) === keep) continue;
      console.warn(
        `[game] stopping orphan ball caller gameId=${session.gameId} (keeper=${keep})`
      );
      if (session.drawTimer) {
        clearInterval(session.drawTimer);
        session.drawTimer = null;
      }
    }
  }

  removeSession(gameId) {
    const session = this.sessions.get(gameId);
    if (session) {
      session.stopCalling();
      this.sessions.delete(gameId);
    }
  }

  listSessions() {
    return [...this.sessions.values()].map((s) => ({
      gameId: s.gameId,
      playersCount: s.playersCount,
      status: s.status,
      calledCount: s.calledNumbers.length,
    }));
  }
}

const gameManager = new GameManager();

module.exports = { GameManager, GameSession, gameManager };
