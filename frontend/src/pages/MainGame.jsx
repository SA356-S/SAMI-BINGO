import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchMainGameData } from '../api/mainGame';
import {
  applyServerGameState,
  cardsToGridMap,
  getSocket,
  normalizeCalledNumbers,
} from '../api/socket';
import MasterBingoGrid from '../components/MasterBingoGrid';
import MainGameCartela from '../components/MainGameCartela';
import { formatBallCall, getBingoLetter } from '../utils/bingoBall';
import WinnerAnnouncement from '../components/WinnerAnnouncement';
import {
  findWinningCartel,
  hasFalseBingoClaim,
  pruneInvalidManualMarks,
  snapshotAutoMarksForCartels,
  toggleManualMarkSynced,
} from '../utils/bingoWin';
import {
  deserializeManualMarks,
  serializeManualMarks,
  getPlayerUserId,
  joinAsWatcher,
} from '../api/gameSession';
import { updateSoundEffects, fetchProfile } from '../api/profile';
import {
  getSoundEffectsEnabled,
  setSoundEffectsEnabled,
  subscribeSoundEffects,
} from '../utils/soundSettings';
import {
  BALL_REVEAL_ANIMATION_MS,
  prepareGameAudioForRound,
  resetBallSoundQueue,
  syncAnnouncedBallsFromHistory,
  unlockGameAudio,
} from '../audio/gameSounds';
import { syncGameAudioFromSnapshot } from '../audio/gameAudioSync';
import {
  clearGameSession,
  initializeGameSession,
  invalidateGameSessionGeneration,
  isActiveGameSessionGeneration,
  registerMainGameResumeHandler,
  registerMainGameSessionReset,
  shouldFallbackToCardSelection,
} from '../services/gameSessionLifecycle';
import { GAME_STATUS, normalizeGameStatus } from '../utils/gameStatus';

const GAME_ENTRY_STAKE = 10;
const MIN_PLAYERS = 2;

function isGenericWinnerName(name) {
  const value = String(name || '').trim();
  if (!value) return true;
  if (/^player(\s+\d+)?$/i.test(value)) return true;
  if (/^\d{5,}$/.test(value)) return true;
  if (/^user\s+\d+$/i.test(value)) return true;
  if (/^robot$/i.test(value)) return true;
  if (/^robot[_:\-\s]/i.test(value)) return true;
  return false;
}

function formatWinnerLabel(name) {
  const value = String(name || '').trim();
  if (!value || isGenericWinnerName(value)) return '';
  if (value.startsWith('@')) return value;
  if (/^[a-zA-Z0-9_]{2,32}$/.test(value)) return `@${value}`;
  return value;
}

function resolveWinnerDisplayName(winner = {}, payload = {}) {
  const candidates = [
    winner?.playerName,
    winner?.displayName,
    winner?.username,
    payload?.winnerLabel,
    payload?.playerName,
    payload?.playerLabel,
  ];

  for (const candidate of candidates) {
    const formatted = formatWinnerLabel(candidate);
    if (formatted) return formatted;
  }

  const fallback = formatWinnerLabel(winner?.playerName || payload?.winnerLabel);
  return fallback || 'Player';
}

function resolveWinnerPrize(winner = {}, payload = {}, winnerCount = 1) {
  const direct = Math.floor(Number(winner?.prize) || 0);
  if (direct > 0) return direct;

  const share = Math.floor(Number(payload?.prizeSharePerWinner) || 0);
  const pool = Math.floor(
    Number(payload?.prize ?? payload?.derash ?? payload?.prizePool) || 0
  );

  if (winnerCount > 1 && share > 0) return share;
  return pool;
}

/** Compare server called-number list to local display; server order wins. */
function resolveIncrementalCalledBalls(prev = [], full = []) {
  if (!Array.isArray(full) || full.length === 0) {
    return { mode: 'none', balls: [] };
  }
  if (!Array.isArray(prev) || prev.length === 0) {
    return { mode: 'incremental', balls: full };
  }
  if (full.length <= prev.length) {
    const matches = prev.every((n, i) => full[i] === n);
    if (matches) return { mode: 'none', balls: [] };
    return { mode: 'resync', balls: full };
  }
  const isPrefix = prev.every((n, i) => full[i] === n);
  if (isPrefix) {
    return { mode: 'incremental', balls: full.slice(prev.length) };
  }
  return { mode: 'resync', balls: full };
}

function omitBallFields(payload = {}) {
  const {
    calledNumbers,
    calledHistory,
    called,
    balls,
    number,
    latestBall,
    calledCount,
    sequence,
    label,
    letter,
    ...rest
  } = payload;
  return rest;
}

const LETTER_TEXT = {
  B: 'text-blue-700',
  I: 'text-violet-700',
  N: 'text-fuchsia-700',
  G: 'text-emerald-700',
  O: 'text-orange-700',
};

const HISTORY_PILL = {
  B: 'bg-[#42a5f5] shadow-[0_0_10px_rgba(66,165,245,0.5)]',
  I: 'bg-[#7e57c2] shadow-[0_0_10px_rgba(126,87,194,0.5)]',
  N: 'bg-[#ec407a] shadow-[0_0_10px_rgba(236,64,122,0.45)]',
  G: 'bg-[#66bb6a] shadow-[0_0_10px_rgba(102,187,106,0.45)]',
  O: 'bg-[#ffa726] shadow-[0_0_10px_rgba(255,167,38,0.45)]',
};

const PANEL =
  'rounded-2xl border border-white/[0.07] bg-[#232842]/96 shadow-[0_10px_28px_rgba(0,0,0,0.32)]';

const BOARD_PANEL =
  'rounded-2xl border border-white/[0.07] bg-[#1f2438]/98 shadow-[0_10px_28px_rgba(0,0,0,0.32)]';

const STAT_BOX =
  'flex min-h-[50px] flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-[#2a3048] px-1.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] sm:min-h-[54px]';

function StatBox({
  label,
  value,
  valueClassName = '',
  containerClassName = '',
  valueTitle,
}) {
  return (
    <div className={`${STAT_BOX} ${containerClassName}`.trim()}>
      <span className="text-[11px] font-semibold capitalize tracking-wide text-white sm:text-[12px]">
        {label}
      </span>
      <span
        title={valueTitle}
        className={`mt-1 max-w-full text-[15px] font-extrabold tabular-nums leading-none text-white ${valueClassName}`}
      >
        {value}
      </span>
    </div>
  );
}

function HistoryBall({ num, isLatestInRow }) {
  const letter = getBingoLetter(num);
  const pill = HISTORY_PILL[letter] ?? HISTORY_PILL.B;

  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[8px] font-extrabold tracking-tight text-white ${pill} ${
        isLatestInRow ? 'ring-2 ring-white/35' : ''
      }`}
      title={formatBallCall(num)}
    >
      {formatBallCall(num)}
    </span>
  );
}

function LatestBallDisplay({ num }) {
  const letter = getBingoLetter(num);
  const text = LETTER_TEXT[letter] ?? 'text-violet-800';

  return (
    <div className="relative flex items-center justify-center py-1">
      <div
        key={num}
        className="relative flex h-[62px] w-[62px] animate-[ballPop_0.35s_ease-out] items-center justify-center sm:h-[72px] sm:w-[72px]"
      >
        <div
          className="absolute -inset-1 rounded-full bg-amber-400/25 blur-md"
          aria-hidden
        />
        <div className="absolute inset-0 rounded-full border-[4px] border-[#f5c542] shadow-[0_0_24px_rgba(245,197,66,0.55)]" />
        <div className="relative flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white shadow-[0_8px_22px_rgba(0,0,0,0.38)] sm:h-[61px] sm:w-[61px]">
          <span className={`text-lg font-extrabold leading-none sm:text-[20px] ${text}`}>
            {formatBallCall(num)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function MainGame() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const stake = state?.stake ?? GAME_ENTRY_STAKE;
  const initialPlayers = Number(state?.playersCount) || 0;

  const isWatchingOnly = Boolean(state?.watchingOnly);
  const sessionCartelsRef = useRef(
    isWatchingOnly
      ? []
      : (state?.selectedCartels ?? []).map(Number).filter((n) => n >= 1)
  );
  const isRejoinSession = Boolean(state?.rejoin) && !isWatchingOnly;

  const [mySocketId, setMySocketId] = useState(() => getSocket().id ?? null);
  const mySocketIdRef = useRef(mySocketId);
  mySocketIdRef.current = mySocketId;
  const [myCartels, setMyCartels] = useState(() => [...sessionCartelsRef.current]);
  const [cartelOwnership, setCartelOwnership] = useState({});

  const activeCartels = myCartels;
  const myCartelCount = activeCartels.length;
  const playerLabel =
    myCartelCount > 0 ? `Player ${myCartelCount}` : null;
  const isPlayer = myCartelCount > 0;

  const [gameId, setGameId] = useState(
    () => state?.gameId ?? null
  );
  const [playersCount, setPlayersCount] = useState(initialPlayers);
  const [totalCards, setTotalCards] = useState(() => Number(state?.totalCards ?? state?.totalCartels) || 0);
  const [serverDerash, setServerDerash] = useState(null);
  const [calledHistory, setCalledHistory] = useState(() =>
    isRejoinSession ? normalizeCalledNumbers(state ?? {}) : []
  );
  const [cartelGrids, setCartelGrids] = useState(() =>
    cardsToGridMap(state?.cards ?? [])
  );
  const [automatic, setAutomatic] = useState(() => state?.automatic ?? true);
  const [soundOn, setSoundOn] = useState(() => getSoundEffectsEnabled());
  const [manualMarks, setManualMarks] = useState(() =>
    deserializeManualMarks(state?.manualMarks)
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bingoNotice, setBingoNotice] = useState(null);
  const [gameWon, setGameWon] = useState(false);
  const [winnerAnnouncement, setWinnerAnnouncement] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  const bingoReportedRef = useRef(false);
  const gameWonRef = useRef(false);
  const joinedRef = useRef(false);
  const exitedToSelectionRef = useRef(false);
  const ignoreGameUpdatesRef = useRef(false);
  const calledHistoryRef = useRef([]);
  const lastBallSequenceRef = useRef(0);
  const pendingGameResetRef = useRef(null);
  const pendingResetFallbackTimerRef = useRef(null);
  const manualMarksRef = useRef(manualMarks);
  const activeCartelsRef = useRef(activeCartels);
  const automaticRef = useRef(automatic);
  const marksSyncTimerRef = useRef(null);
  const bingoNoticeTimerRef = useRef(null);
  const sessionLiveRef = useRef(false);
  const sessionHandlersRef = useRef(null);
  gameWonRef.current = gameWon;
  calledHistoryRef.current = calledHistory;
  manualMarksRef.current = manualMarks;
  activeCartelsRef.current = activeCartels;
  automaticRef.current = automatic;

  useEffect(() => {
    exitedToSelectionRef.current = false;
    ignoreGameUpdatesRef.current = false;
    joinedRef.current = false;
    sessionLiveRef.current = false;
    lastBallSequenceRef.current = 0;

    if (!isWatchingOnly && sessionCartelsRef.current.length < 1) {
      navigate('/card-selection', { replace: true });
    }
  }, [navigate, isWatchingOnly]);

  useEffect(() => {
    if (myCartels.length > 0) {
      sessionCartelsRef.current = [...myCartels];
    }
  }, [myCartels]);

  useEffect(() => {
    if (
      myCartels.length === 0 &&
      sessionCartelsRef.current.length > 0 &&
      !gameWonRef.current &&
      !ignoreGameUpdatesRef.current
    ) {
      setMyCartels([...sessionCartelsRef.current]);
    }
  }, [myCartels.length]);

  useEffect(() => {
    if (!isRejoinSession) return;
    const initial = normalizeCalledNumbers(state ?? {});
    if (initial.length > 0) {
      syncAnnouncedBallsFromHistory(initial);
      calledHistoryRef.current = initial;
    }
  }, [isRejoinSession, state]);

  useEffect(() => {
    fetchProfile(getPlayerUserId()).catch(() => {});
    const unsubSound = subscribeSoundEffects(setSoundOn);
    return () => {
      unsubSound();
    };
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEffectsEnabled(next);
    if (next) {
      unlockGameAudio();
    } else {
      resetBallSoundQueue();
    }
    updateSoundEffects(getPlayerUserId(), next).catch(() => {
      const revert = !next;
      setSoundOn(revert);
      setSoundEffectsEnabled(revert);
    });
  }, [soundOn]);

  const calledSet = useMemo(() => new Set(calledHistory), [calledHistory]);
  const latestBall = calledHistory[calledHistory.length - 1] ?? null;
  const recentBalls = calledHistory.slice(0, -1).slice(-4).reverse();

  const derash = serverDerash ?? 0;

  const stateSetters = useMemo(
    () => ({
      setGameId,
      setMySocketId,
      setMyCartels,
      setCartelOwnership,
      get mySocketId() {
        return mySocketIdRef.current;
      },
      setPlayersCount: (n) => {
        const count = Number(n);
        if (Number.isFinite(count) && count >= 0) setPlayersCount(count);
      },
      setTotalCards: (n) => {
        const count = Number(n);
        if (Number.isFinite(count) && count >= 0) setTotalCards(count);
      },
      setCalledHistory,
      setCartelGrids,
      setDerash: setServerDerash,
    }),
    []
  );

  const syncFromServer = useCallback(
    (data) => {
      if (data?.socketId) setMySocketId(String(data.socketId));
      applyServerGameState(data, stateSetters);
    },
    [stateSetters]
  );

  const winnerAnnouncementRef = useRef(null);
  winnerAnnouncementRef.current = winnerAnnouncement;

  const applyWinnerFromServer = useCallback(
    (payload) => {
      if (gameWonRef.current || winnerAnnouncementRef.current) return;

      const activeGameId = gameIdRef.current ?? state?.gameId;
      if (
        payload?.gameId &&
        activeGameId &&
        String(payload.gameId) !== String(activeGameId)
      ) {
        return;
      }

      let cartelId = Number(payload?.primaryCartelId ?? payload?.cartelId);
      if (!Number.isInteger(cartelId) || cartelId < 1) {
        const firstWinner = Array.isArray(payload?.winners) ? payload.winners[0] : null;
        cartelId = Number(firstWinner?.cartelId);
      }
      if (!Number.isInteger(cartelId) || cartelId < 1) return;

      bingoReportedRef.current = true;
      gameWonRef.current = true;

      if (Array.isArray(payload?.calledNumbers) && payload.calledNumbers.length > 0) {
        const balls = normalizeCalledNumbers(payload);
        calledHistoryRef.current = balls;
        setCalledHistory(balls);
      }

      if (payload?.prize != null || payload?.derash != null) {
        setServerDerash(Number(payload.prize ?? payload.derash));
      }

      const winnerCount = Array.isArray(payload?.winners)
        ? payload.winners.length
        : 1;

      const winners = Array.isArray(payload?.winners) && payload.winners.length > 0
        ? payload.winners.map((w) => ({
            ...w,
            playerName: resolveWinnerDisplayName(w, payload),
            prize: resolveWinnerPrize(w, payload, winnerCount),
          }))
        : [
            {
              playerName: resolveWinnerDisplayName(payload, payload),
              cartelId,
              prize: resolveWinnerPrize(payload, payload, 1),
            },
          ];

      const announcement = {
        winners,
        primaryCartelId: cartelId,
        calledNumbers: normalizeCalledNumbers(payload).length
          ? normalizeCalledNumbers(payload)
          : calledHistory,
        manualMarksByCartel: manualMarks,
        automatic,
        gameId: payload?.gameId ?? gameId ?? '—',
        prize: payload?.prize ?? payload?.derash ?? derash,
        prizeSharePerWinner: payload?.prizeSharePerWinner,
        prizePool: payload?.prizePool,
      };

      winnerAnnouncementRef.current = announcement;
      if (pendingResetFallbackTimerRef.current) {
        window.clearTimeout(pendingResetFallbackTimerRef.current);
        pendingResetFallbackTimerRef.current = null;
      }
      setGameWon(true);
      setWinnerAnnouncement(announcement);

      console.info('[game][bingo-announce] Winner announcement displayed', {
        gameId: payload?.gameId ?? gameId ?? null,
        primaryCartelId: cartelId,
        winnerCount: winners.length,
      });
    },
    [
      calledHistory,
      manualMarks,
      automatic,
      gameId,
      derash,
      state?.gameId,
    ]
  );

  const applyWinnerFromServerRef = useRef(applyWinnerFromServer);
  applyWinnerFromServerRef.current = applyWinnerFromServer;

  const clearLocalGameState = useCallback(() => {
    pendingGameResetRef.current = null;
    if (pendingResetFallbackTimerRef.current) {
      window.clearTimeout(pendingResetFallbackTimerRef.current);
      pendingResetFallbackTimerRef.current = null;
    }
    if (bingoNoticeTimerRef.current) {
      clearTimeout(bingoNoticeTimerRef.current);
      bingoNoticeTimerRef.current = null;
    }
    if (marksSyncTimerRef.current) {
      clearTimeout(marksSyncTimerRef.current);
      marksSyncTimerRef.current = null;
    }
    sessionCartelsRef.current = [];
    setCalledHistory([]);
    setCartelGrids({});
    setManualMarks({});
    setMyCartels([]);
    setCartelOwnership({});
    setServerDerash(null);
    setGameWon(false);
    setWinnerAnnouncement(null);
    bingoReportedRef.current = false;
    gameWonRef.current = false;
    joinedRef.current = false;
    ignoreGameUpdatesRef.current = true;
    lastBallSequenceRef.current = 0;
  }, []);

  useEffect(() => registerMainGameSessionReset(clearLocalGameState), [clearLocalGameState]);

  const exitToCardSelection = useCallback(
    (payload = {}) => {
      if (exitedToSelectionRef.current) return;
      exitedToSelectionRef.current = true;
      clearGameSession();
      navigate('/card-selection', { replace: true });
    },
    [navigate]
  );

  useEffect(
    () => () => {
      if (bingoNoticeTimerRef.current) {
        clearTimeout(bingoNoticeTimerRef.current);
        bingoNoticeTimerRef.current = null;
      }
      if (pendingResetFallbackTimerRef.current) {
        window.clearTimeout(pendingResetFallbackTimerRef.current);
        pendingResetFallbackTimerRef.current = null;
      }
    },
    []
  );

  const exitToCardSelectionRef = useRef(exitToCardSelection);
  exitToCardSelectionRef.current = exitToCardSelection;

  const finishWinnerRoundExit = useCallback(() => {
    const pending = pendingGameResetRef.current;
    pendingGameResetRef.current = null;
    exitToCardSelection({
      gameId: pending?.gameId ?? gameIdRef.current ?? gameId,
    });
  }, [exitToCardSelection, gameId]);

  const finishWinnerRoundExitRef = useRef(finishWinnerRoundExit);
  finishWinnerRoundExitRef.current = finishWinnerRoundExit;

  const deferGameResetUntilAnnouncement = useCallback((payload = {}) => {
    const activeGameId = gameIdRef.current ?? state?.gameId;
    const resetGameId = payload?.gameId;
    if (
      resetGameId &&
      activeGameId &&
      String(resetGameId) !== String(activeGameId)
    ) {
      return;
    }

    pendingGameResetRef.current = payload;

    if (winnerAnnouncementRef.current) {
      return;
    }

    if (!pendingResetFallbackTimerRef.current) {
      pendingResetFallbackTimerRef.current = window.setTimeout(() => {
        pendingResetFallbackTimerRef.current = null;
        if (!winnerAnnouncementRef.current && pendingGameResetRef.current) {
          exitToCardSelectionRef.current(pendingGameResetRef.current);
        }
      }, 10000);
    }
  }, [state?.gameId]);

  const deferGameResetUntilAnnouncementRef = useRef(deferGameResetUntilAnnouncement);
  deferGameResetUntilAnnouncementRef.current = deferGameResetUntilAnnouncement;

  const showNoBingoNotice = useCallback(() => {
    setBingoNotice('No Bingo');
    if (bingoNoticeTimerRef.current) clearTimeout(bingoNoticeTimerRef.current);
    bingoNoticeTimerRef.current = setTimeout(() => {
      setBingoNotice(null);
      bingoNoticeTimerRef.current = null;
    }, 2200);
  }, []);

  const submitBingoClaim = useCallback(
    (winnerId) => {
      if (!isPlayer || gameWon || bingoReportedRef.current) return;

      bingoReportedRef.current = true;
      const socket = getSocket();
      socket.emit(
        'game:bingo',
        {
          gameId: gameIdRef.current,
          cartelId: winnerId,
          primaryCartelId: winnerId,
          playerName: getPlayerUserId(),
          userId: getPlayerUserId(),
          calledNumbers: calledHistoryRef.current,
        },
        (ack) => {
          if (ack?.ok === false) {
            bingoReportedRef.current = false;
            showNoBingoNotice();
          }
        }
      );
    },
    [isPlayer, gameWon, showNoBingoNotice]
  );

  const submitBingoClaimRef = useRef(submitBingoClaim);
  submitBingoClaimRef.current = submitBingoClaim;

  const checkBingoAfterBall = useCallback((ball) => {
    if (!isPlayer || gameWonRef.current || bingoReportedRef.current) return;
    if (!automaticRef.current) return;

    const history = calledHistoryRef.current;
    if (!history.includes(ball)) return;

    const calledSetLocal = new Set(history);
    const winnerId = findWinningCartel(
      activeCartelsRef.current,
      calledSetLocal,
      manualMarksRef.current,
      true
    );

    if (winnerId != null) {
      submitBingoClaimRef.current(winnerId);
    }
  }, [isPlayer]);

  const applyLiveBallToUI = useCallback(
    (ball) => {
      const n = Math.floor(Number(ball));
      if (!Number.isFinite(n) || n < 1 || n > 75) return;
      if (gameWonRef.current || ignoreGameUpdatesRef.current) return;

      const prev = calledHistoryRef.current;
      if (!prev.includes(n)) {
        const next = [...prev, n];
        calledHistoryRef.current = next;
        setCalledHistory(next);
      }

      window.setTimeout(() => {
        if (!gameWonRef.current && !ignoreGameUpdatesRef.current) {
          checkBingoAfterBall(n);
        }
      }, BALL_REVEAL_ANIMATION_MS);
    },
    [checkBingoAfterBall]
  );

  const syncCalledHistorySilently = useCallback((balls) => {
    const list = Array.isArray(balls) ? balls : [];
    calledHistoryRef.current = list;
    setCalledHistory(list);
    syncAnnouncedBallsFromHistory(list);
  }, []);

  /**
   * @param {number[]} balls
   */
  const syncRejoinCalledBalls = useCallback((balls) => {
    const list = Array.isArray(balls) ? balls : [];
    calledHistoryRef.current = list;
    setCalledHistory(list);
    syncAnnouncedBallsFromHistory(list);
    syncGameAudioFromSnapshot({
      gameId: gameIdRef.current,
      calledNumbers: list,
      sequence: list.length,
    });
  }, []);

  const applyBallDrawPayload = useCallback(
    (payload, source) => {
      if (gameWonRef.current || ignoreGameUpdatesRef.current) return;

      const isSnapshot =
        payload?.ballSync === 'snapshot' ||
        payload?.syncMode === 'snapshot' ||
        source === 'game:sync' ||
        source === 'game:rejoin';

      const fullHistory = normalizeCalledNumbers(payload);

      if (isSnapshot) {
        if (fullHistory.length > 0) {
          const seq = Number(payload?.sequence ?? payload?.calledCount);
          if (Number.isFinite(seq) && seq > 0) {
            lastBallSequenceRef.current = Math.max(lastBallSequenceRef.current, seq);
          } else {
            lastBallSequenceRef.current = Math.max(
              lastBallSequenceRef.current,
              fullHistory.length
            );
          }

          syncRejoinCalledBalls(fullHistory);
          syncGameAudioFromSnapshot({
            ...payload,
            gameId: payload?.gameId ?? gameIdRef.current,
            calledNumbers: fullHistory,
            sequence: lastBallSequenceRef.current,
          });
        }
        return;
      }

      /** Live draw — UI only; audio comes from server ball_called event. */
      const isLiveDraw =
        payload?.ballSync === 'live' ||
        source === 'ball:called' ||
        source === 'newNumber';

      const liveDrawnBall = Number(payload?.number);
      if (
        isLiveDraw &&
        Number.isFinite(liveDrawnBall) &&
        liveDrawnBall >= 1 &&
        liveDrawnBall <= 75
      ) {
        const sequence = Number(payload?.sequence);
        if (Number.isFinite(sequence) && sequence > 0) {
          if (sequence <= lastBallSequenceRef.current) {
            return;
          }
          lastBallSequenceRef.current = sequence;
        }

        applyLiveBallToUI(liveDrawnBall);
        return;
      }

      if (fullHistory.length > 0) {
        const prev = calledHistoryRef.current;
        const { mode, balls } = resolveIncrementalCalledBalls(prev, fullHistory);

        if (mode === 'resync' || (mode === 'incremental' && prev.length === 0)) {
          syncRejoinCalledBalls(fullHistory);
          syncGameAudioFromSnapshot({
            ...payload,
            gameId: payload?.gameId ?? gameIdRef.current,
            calledNumbers: fullHistory,
          });
          return;
        }

        if (mode === 'incremental') {
          if (source === 'game:update') {
            syncCalledHistorySilently(fullHistory);
            syncGameAudioFromSnapshot({
              ...payload,
              gameId: payload?.gameId ?? gameIdRef.current,
              calledNumbers: fullHistory,
            });
            return;
          }
          for (const ball of balls) {
            applyLiveBallToUI(ball);
          }
        }
        return;
      }

      const fallbackBall = Number(payload?.number ?? payload?.latestBall);
      if (Number.isFinite(fallbackBall) && fallbackBall >= 1 && fallbackBall <= 75) {
        applyLiveBallToUI(fallbackBall);
      }
    },
    [applyLiveBallToUI, syncRejoinCalledBalls, syncCalledHistorySilently]
  );

  const revealWinnerFromServer = useCallback((payload) => {
    if (gameWonRef.current && winnerAnnouncementRef.current) return;

    const winnerBalls = normalizeCalledNumbers(payload);
    if (winnerBalls.length > 0) {
      syncRejoinCalledBalls(winnerBalls);
    }

    applyWinnerFromServerRef.current(payload);
  }, [syncRejoinCalledBalls]);

  const revealWinnerFromServerRef = useRef(revealWinnerFromServer);
  revealWinnerFromServerRef.current = revealWinnerFromServer;

  const applyPendingWinner = useCallback((payload) => {
    if (!payload || gameWonRef.current) return;
    const winnerPayload =
      payload.winnerAnnouncement ??
      (payload.status === 'ended' &&
      Array.isArray(payload.winners) &&
      payload.winners.length > 0
        ? payload
        : null) ??
      (payload.gameWon &&
      (payload.primaryCartelId != null || payload.cartelId != null)
        ? payload
        : null);
    if (
      winnerPayload &&
      (winnerPayload.primaryCartelId != null ||
        winnerPayload.cartelId != null ||
        (Array.isArray(winnerPayload.winners) && winnerPayload.winners.length > 0))
    ) {
      revealWinnerFromServerRef.current(winnerPayload);
    }
  }, []);

  const resumeGameFromServer = useCallback(
    async ({ status, generation }) => {
      if (!isActiveGameSessionGeneration(generation)) return;

      const gameStatus = normalizeGameStatus(status);
      const socket = getSocket();
      const userId = getPlayerUserId();

      if (
        gameStatus === GAME_STATUS.FINISHED ||
        gameStatus === GAME_STATUS.WAITING
      ) {
        applyPendingWinner(status);
        if (!winnerAnnouncementRef.current && !gameWonRef.current) {
          clearGameSession();
          navigate('/card-selection', { replace: true });
        }
        return;
      }

      if (gameStatus !== GAME_STATUS.RUNNING) return;

      ignoreGameUpdatesRef.current = false;
      lastBallSequenceRef.current = 0;

      const gameId = status?.gameId ?? gameIdRef.current;
      if (!gameId) return;

      let ack;
      if (isWatchingOnly) {
        ack = await joinAsWatcher(userId, gameId);
      } else if (sessionCartelsRef.current.length > 0) {
        ack = await new Promise((resolve) => {
          socket.emit(
            'game:rejoin',
            { gameId, userId, playerName: userId },
            resolve
          );
        });
      } else {
        ack = await new Promise((resolve) => {
          socket.emit('game:state', { gameId }, resolve);
        });
      }

      if (!isActiveGameSessionGeneration(generation)) return;
      if (ack?.ok === false) return;

      if (ack.gameId) {
        const id = String(ack.gameId);
        gameIdRef.current = id;
        setGameId(id);
      }

      syncFromServer(omitBallFields(ack));

      const balls = normalizeCalledNumbers(ack);
      syncRejoinCalledBalls(balls);

      if (ack.manualMarks) {
        setManualMarks(deserializeManualMarks(ack.manualMarks));
      }
      if (typeof ack.automatic === 'boolean') {
        setAutomatic(ack.automatic);
      }

      const cartels = (ack.myCartels ?? ack.selectedCartels ?? []).map(Number);
      if (cartels.length > 0 && !isWatchingOnly) {
        sessionCartelsRef.current = cartels;
        setMyCartels(cartels);
      }

      applyPendingWinner(ack);
      joinedRef.current = true;
      sessionLiveRef.current = true;
    },
    [
      isWatchingOnly,
      syncFromServer,
      syncRejoinCalledBalls,
      applyPendingWinner,
      navigate,
    ]
  );

  useEffect(
    () => registerMainGameResumeHandler(resumeGameFromServer),
    [resumeGameFromServer]
  );

  const applyBallDrawPayloadRef = useRef(applyBallDrawPayload);
  applyBallDrawPayloadRef.current = applyBallDrawPayload;
  const syncCalledHistorySilentlyRef = useRef(syncCalledHistorySilently);
  syncCalledHistorySilentlyRef.current = syncCalledHistorySilently;

  const handleBingoClaim = useCallback(() => {
    if (!isPlayer || gameWon || automatic) return;

    const winnerId = findWinningCartel(
      activeCartels,
      calledSet,
      manualMarks,
      automatic
    );

    if (winnerId != null) {
      submitBingoClaim(winnerId);
      return;
    }

    if (hasFalseBingoClaim(activeCartels, calledSet, manualMarks, automatic)) {
      showNoBingoNotice();
      return;
    }

    showNoBingoNotice();
  }, [
    isPlayer,
    gameWon,
    automatic,
    activeCartels,
    calledSet,
    manualMarks,
    showNoBingoNotice,
    submitBingoClaim,
  ]);

  const handleSessionInitResult = useCallback(
    (result) => {
      if (result?.ok && !result?.aborted) {
        sessionLiveRef.current = true;
        return;
      }
      if (result?.aborted) return;
      joinedRef.current = false;
      sessionLiveRef.current = false;
      if (shouldFallbackToCardSelection(result)) {
        navigate('/card-selection', { replace: true });
      }
    },
    [navigate]
  );

  useEffect(() => {
    if (state?.gameId) setGameId(state.gameId);
  }, [state?.gameId]);

  useEffect(() => {
    const socket = getSocket();

    const adoptGameId = (payload) => {
      if (!payload?.gameId) return;
      const id = String(payload.gameId);
      gameIdRef.current = id;
      setGameId(id);
    };

    const onConnect = () => {
      setSocketConnected(true);
      setMySocketId(socket.id);

      if (!sessionLiveRef.current || ignoreGameUpdatesRef.current) return;

      const needsWinnerResync =
        gameWonRef.current && !winnerAnnouncementRef.current;

      if (gameWonRef.current && !needsWinnerResync) return;
      if (!gameIdRef.current) return;

      const reconnectMode = isWatchingOnly
        ? 'watch'
        : sessionCartelsRef.current.length > 0
          ? 'rejoin'
          : 'sync';

      void initializeGameSession({
        mode: reconnectMode,
        gameId: gameIdRef.current,
        cartels: sessionCartelsRef.current,
        stake,
        handlers: sessionHandlersRef.current,
      }).then(handleSessionInitResult);
    };
    const onDisconnect = () => setSocketConnected(false);

    const onNumberCalled = (payload) => {
      if (gameWonRef.current || ignoreGameUpdatesRef.current) return;
      adoptGameId(payload);
      const activeGameId = gameIdRef.current ?? state?.gameId;
      if (
        payload?.gameId &&
        activeGameId &&
        String(payload.gameId) !== String(activeGameId)
      ) {
        return;
      }

      console.info('[bingo-draw] socket newNumber', {
        number: payload?.number,
        latestBall: payload?.latestBall,
        sequence: payload?.sequence,
      });

      applyBallDrawPayloadRef.current(payload, 'newNumber');

      if (payload?.derash != null) setServerDerash(Number(payload.derash));
    };

    const onGameUpdate = (payload) => {
      if (gameWonRef.current || ignoreGameUpdatesRef.current) return;
      adoptGameId(payload);
      if (gameIdRef.current && payload?.gameId && payload.gameId !== gameIdRef.current) {
        return;
      }
      if (payload?.clearGame) return;

      if (payload?.derash != null) setServerDerash(Number(payload.derash));
      if (payload?.playersCount != null) {
        const count = Number(payload.playersCount);
        if (Number.isFinite(count) && count >= 0) setPlayersCount(count);
      }
      if (payload?.cartelOwnership) {
        syncFromServer({
          cartelOwnership: payload.cartelOwnership,
          gameId: payload.gameId,
        });
      }

      const history = normalizeCalledNumbers(payload);
      if (history.length > 0) {
        const seq = Number(payload?.sequence ?? history.length);
        if (
          Number.isFinite(seq) &&
          seq > 0 &&
          seq <= lastBallSequenceRef.current
        ) {
          return;
        }
        if (Number.isFinite(seq) && seq > 0) {
          lastBallSequenceRef.current = Math.max(
            lastBallSequenceRef.current,
            seq
          );
        }
        syncCalledHistorySilentlyRef.current(history);
      }
    };

    const onGameWinner = (payload) => {
      revealWinnerFromServerRef.current(payload);
    };

    const onGameEnded = (payload) => {
      revealWinnerFromServerRef.current(payload);
    };

    const onGameReset = (payload) => {
      deferGameResetUntilAnnouncementRef.current(payload);
    };

    const onGameRedirect = (payload) => {
      deferGameResetUntilAnnouncementRef.current(payload);
    };

    const onPlayers = (payload) => {
      if (payload?.playersCount != null) {
        const count = Number(payload.playersCount);
        if (Number.isFinite(count) && count >= 0) setPlayersCount(count);
      }
    };

    const onGameSync = (payload) => {
      if (ignoreGameUpdatesRef.current) return;
      adoptGameId(payload);
      syncFromServer(omitBallFields(payload));
      applyBallDrawPayloadRef.current(payload, 'game:sync');
      applyPendingWinner(payload);
    };

    const onJoined = (payload) => {
      if (ignoreGameUpdatesRef.current) return;
      adoptGameId(payload);
      syncFromServer(omitBallFields(payload));
      applyBallDrawPayloadRef.current(payload, 'game:sync');
      applyPendingWinner(payload);
    };
    const onStarted = (payload) => {
      if (ignoreGameUpdatesRef.current) return;
      void prepareGameAudioForRound();
      adoptGameId(payload);
      syncFromServer(omitBallFields(payload));
      applyBallDrawPayloadRef.current(payload, 'game:sync');
      applyPendingWinner(payload);
    };
    const onState = (payload) => {
      if (ignoreGameUpdatesRef.current) return;
      adoptGameId(payload);
      syncFromServer(omitBallFields(payload));
      applyBallDrawPayloadRef.current(payload, 'game:sync');
      applyPendingWinner(payload);
    };
    const onError = (payload) => {
      console.warn('[socket] game:error', payload);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('newNumber', onNumberCalled);
    socket.on('game:update', onGameUpdate);
    socket.on('game:players', onPlayers);
    socket.on('game:sync', onGameSync);
    socket.on('game:joined', onJoined);
    socket.on('game:started', onStarted);
    socket.on('game:state', onState);
    socket.on('game:winner', onGameWinner);
    socket.on('game:over', onGameWinner);
    socket.on('game:ended', onGameEnded);
    socket.on('game:reset', onGameReset);
    socket.on('game:redirect', onGameRedirect);
    socket.on('game:error', onError);

    if (socket.connected) {
      setSocketConnected(true);
      setMySocketId(socket.id);
    }

    const joinCartels = sessionCartelsRef.current;
    let entryMode = 'none';

    if (isRejoinSession && !joinedRef.current) {
      entryMode = 'rejoin';
    } else if (joinCartels.length > 0 && !joinedRef.current) {
      entryMode = 'join';
    } else if (isWatchingOnly && !joinedRef.current) {
      entryMode = 'watch';
    } else if (state?.gameId && !isRejoinSession && !joinedRef.current) {
      entryMode = 'sync';
    }

    sessionHandlersRef.current = {
      adoptGameId,
      applyServerSnapshot: (ack) => syncFromServer(omitBallFields(ack)),
      applyBallDraw: (ack, source) =>
        applyBallDrawPayloadRef.current(ack, source),
      applyPendingWinner,
      setManualMarks: (raw) => setManualMarks(deserializeManualMarks(raw)),
      setAutomatic,
      setMyCartels,
      updateSessionCartels: (cartels) => {
        sessionCartelsRef.current = cartels;
      },
    };

    if (entryMode !== 'none') {
      joinedRef.current = true;
      void initializeGameSession({
        mode: entryMode,
        gameId: state?.gameId ?? gameIdRef.current,
        cartels: joinCartels,
        stake,
        handlers: sessionHandlersRef.current,
      }).then(handleSessionInitResult);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('newNumber', onNumberCalled);
      socket.off('game:update', onGameUpdate);
      socket.off('game:players', onPlayers);
      socket.off('game:sync', onGameSync);
      socket.off('game:joined', onJoined);
      socket.off('game:started', onStarted);
      socket.off('game:state', onState);
      socket.off('game:winner', onGameWinner);
      socket.off('game:over', onGameWinner);
      socket.off('game:ended', onGameEnded);
      socket.off('game:reset', onGameReset);
      socket.off('game:redirect', onGameRedirect);
      socket.off('game:error', onError);
    };
  }, [
    stake,
    state?.gameId,
    state?.rejoin,
    state?.watchingOnly,
    isRejoinSession,
    isWatchingOnly,
    handleSessionInitResult,
  ]);

  useEffect(
    () => () => {
      invalidateGameSessionGeneration();
    },
    []
  );

  useEffect(() => {
    if (!isPlayer || ignoreGameUpdatesRef.current || gameWon) return undefined;

    const socket = getSocket();
    marksSyncTimerRef.current = setTimeout(() => {
      socket.emit('game:marks-update', {
        gameId: gameIdRef.current,
        userId: getPlayerUserId(),
        manualMarks: serializeManualMarks(manualMarks),
        automatic,
      });
    }, 350);

    return () => {
      if (marksSyncTimerRef.current) clearTimeout(marksSyncTimerRef.current);
    };
  }, [manualMarks, automatic, isPlayer, gameWon]);

  const toggleManualMark = (cartelId, row, col) => {
    setManualMarks((prev) =>
      toggleManualMarkSynced({
        tappedCartelId: cartelId,
        row,
        col,
        cartelIds: activeCartels,
        calledNumbers: calledSet,
        gridsByCartel: cartelGrids,
        existingMarks: prev,
      })
    );
  };

  const handleAutomaticToggle = () => {
    if (automatic) {
      if (activeCartels.length > 0) {
        setManualMarks((prev) =>
          snapshotAutoMarksForCartels(activeCartels, calledSet, prev)
        );
      }
    } else if (activeCartels.length > 0) {
      setManualMarks((prev) =>
        pruneInvalidManualMarks(activeCartels, calledSet, prev)
      );
    }
    setAutomatic((a) => !a);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const socket = getSocket();
    const currentId = gameIdRef.current;

    try {
      if (currentId) {
        socket.emit('game:state', { gameId: currentId }, (ack) => {
          if (ack?.ok !== false) {
            syncFromServer(omitBallFields(ack));
            applyBallDrawPayloadRef.current(ack, 'game:sync');
          }
        });
      }

      const data = await fetchMainGameData(currentId);
      if (data) {
        if (data.playersCount >= 0) {
          setPlayersCount(data.playersCount);
        }
        if (data.derash != null) setServerDerash(data.derash);
        if (data.calledNumbers.length > 0) {
          applyBallDrawPayloadRef.current(
            { calledNumbers: data.calledNumbers },
            'game:sync'
          );
        }
        if (data.gameId) setGameId(data.gameId);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLeave = () => {
    const socket = getSocket();
    ignoreGameUpdatesRef.current = true;
    socket.emit('game:leave', {
      temporary: true,
      userId: getPlayerUserId(),
      gameId: gameIdRef.current,
    });
    exitedToSelectionRef.current = false;
    navigate('/');
  };

  const displayGameId = gameId ?? (socketConnected ? '…' : '—');

  return (
    <div
      className={`main-game-page relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden font-sans text-white ${
        winnerAnnouncement ? 'bg-[#0b0d17]' : 'bg-theme-game'
      }`}
    >
      <style>{`
        @keyframes ballPop {
          0% { transform: scale(0.88); opacity: 0.65; }
          60% { transform: scale(1.04); }
          100% { transform: scale(1); opacity: 1; }
        }
        .main-game-page .drawn-numbers-scroll {
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .main-game-page .drawn-numbers-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      {bingoNotice && !winnerAnnouncement && (
        <div
          className="pointer-events-none absolute inset-x-0 top-16 z-[60] flex justify-center px-4"
          role="status"
          aria-live="polite"
        >
          <p className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-lg">
            {bingoNotice}
          </p>
        </div>
      )}
      {winnerAnnouncement && (
        <WinnerAnnouncement
          winners={winnerAnnouncement.winners}
          primaryCartelId={winnerAnnouncement.primaryCartelId}
          calledNumbers={winnerAnnouncement.calledNumbers}
          manualMarksByCartel={winnerAnnouncement.manualMarksByCartel}
          automatic={winnerAnnouncement.automatic}
          gameId={winnerAnnouncement.gameId}
          onComplete={() => finishWinnerRoundExitRef.current()}
        />
      )}
      {!winnerAnnouncement && (
        <>
      <header className="shrink-0 px-2 pb-1.5 pt-2 sm:px-3 sm:pb-2 sm:pt-2.5">
        <div
          className="grid gap-1.5 sm:gap-2"
          style={{
            gridTemplateColumns: 'minmax(0, 1.45fr) repeat(4, minmax(0, 1fr))',
          }}
        >
          <StatBox
            label="Game ID"
            value={displayGameId}
            containerClassName="min-w-0 w-full max-w-full overflow-hidden"
            valueTitle={
              gameId && displayGameId !== '…' && displayGameId !== '—'
                ? String(displayGameId)
                : undefined
            }
            valueClassName="block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[12px] sm:text-[13px]"
          />
          <StatBox label="Cards" value={totalCards} />
          <StatBox label="Bet" value={stake} />
          <StatBox label="Derash" value={derash} />
          <StatBox label="Called" value={calledHistory.length} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-row gap-2 overflow-hidden px-2 pb-2 sm:gap-2.5 sm:px-3 sm:pb-2.5">
        <section
          className={`flex h-full min-h-0 min-w-0 flex-[0.92] flex-col overflow-hidden p-2 sm:p-2.5 ${BOARD_PANEL}`}
        >
          <MasterBingoGrid
            calledNumbers={calledSet}
            latestBall={latestBall}
          />
        </section>

        <section className="flex h-full min-h-0 min-w-0 flex-[1.08] flex-col gap-2 overflow-hidden">
          <div
            className={`flex shrink-0 items-center justify-between gap-2 px-2.5 py-1.5 ${PANEL}`}
          >
            <div className="drawn-numbers-scroll flex h-7 max-h-7 min-h-7 flex-1 flex-nowrap items-center justify-start gap-1.5 overflow-x-auto overflow-y-hidden">
              {recentBalls.length > 0 ? (
                recentBalls.map((n, i) => (
                  <HistoryBall
                    key={`${n}-${i}`}
                    num={n}
                    isLatestInRow={i === 0}
                  />
                ))
              ) : (
                <span className="text-[10px] font-semibold text-white/40">—</span>
              )}
            </div>
            <button
              type="button"
              onClick={toggleSound}
              className={`shrink-0 touch-manipulation rounded-lg border border-white/[0.08] bg-[#2a3048] p-1.5 transition active:scale-[0.98] ${
                soundOn ? 'text-white' : 'text-white/55'
              }`}
              aria-label={soundOn ? 'Sound on' : 'Sound off'}
            >
              {soundOn ? (
                <Volume2 className="h-4 w-4" strokeWidth={2} />
              ) : (
                <VolumeX className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          </div>

          <div
            className={`flex shrink-0 items-center justify-center ${PANEL}`}
          >
            {latestBall != null ? (
              <LatestBallDisplay num={latestBall} />
            ) : (
              <span className="py-6 text-[11px] font-semibold text-white/35">—</span>
            )}
          </div>

          {isPlayer ? (
            <div
              className={`flex shrink-0 items-center justify-between px-3 py-1.5 ${PANEL}`}
            >
              <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white">
                Automatic
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={automatic}
                onClick={handleAutomaticToggle}
                className={`relative h-6 w-[40px] shrink-0 touch-manipulation rounded-full transition-all duration-200 ${
                  automatic
                    ? 'bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.42)]'
                    : 'bg-[#4a4f68] shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]'
                }`}
              >
                <span
                  className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.28)] transition-all duration-200 ${
                    automatic ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          ) : null}

          <div
            className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden p-1.5 sm:p-2 ${PANEL}`}
          >
            {isPlayer ? (
              <div className="grid min-h-0 flex-1 grid-rows-2 gap-1.5">
                {activeCartels.map((cartelId) => (
                  <MainGameCartela
                    key={cartelId}
                    cartelId={cartelId}
                    grid={cartelGrids[cartelId]}
                    calledNumbers={calledSet}
                    automatic={automatic}
                    manualMarks={manualMarks[cartelId]}
                    onToggleMark={(row, col) => toggleManualMark(cartelId, row, col)}
                    stacked
                  />
                ))}
              </div>
            ) : (
              <div
                className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[20px] bg-[#1c1b33] px-5 py-8 text-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.42)] sm:rounded-[22px] sm:px-6 sm:py-10"
              >
                <p className="text-[21px] font-bold uppercase tracking-[0.05em] text-white sm:text-[23px]">
                  Watching Only
                </p>
                <div className="mt-4 space-y-0.5 text-[11px] font-normal leading-[1.55] text-[#e0e0e0] sm:mt-5 sm:text-[12px]">
                  <p>የዚህ ዙር ጨዋታ</p>
                  <p>ተጀምሯል:: አዲስ</p>
                  <p>ዙር እስኪጀምር</p>
                  <p>እዚህ ይጠብቁ::</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="flex shrink-0 items-stretch gap-2 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-1.5 sm:px-3 sm:pb-3">
        <button
          type="button"
          onClick={handleLeave}
          className="min-h-[50px] min-w-0 flex-1 touch-manipulation rounded-2xl bg-[#ef5350] py-3 text-[12px] font-extrabold uppercase tracking-wide text-white shadow-[0_8px_20px_rgba(239,83,80,0.35)] transition active:scale-[0.98]"
        >
          Leave
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex min-h-[50px] min-w-0 flex-1 touch-manipulation items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-[#2a3048] px-3 py-3 text-[12px] font-extrabold uppercase tracking-wide text-white shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition active:scale-[0.98] disabled:opacity-55"
        >
          <RefreshCw
            className={`h-4 w-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            aria-hidden
          />
          <span className="truncate">Refresh</span>
        </button>
        <button
          type="button"
          disabled={!isPlayer || gameWon || automatic}
          onClick={handleBingoClaim}
          className={`min-h-[50px] min-w-0 flex-1 touch-manipulation rounded-2xl py-3 text-[12px] font-extrabold uppercase tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed ${
            isPlayer
              ? automatic
                ? 'bg-[#22c55e] text-[#0f172a] shadow-[0_8px_20px_rgba(34,197,94,0.30)]'
                : 'bg-[#22c55e] text-white shadow-[0_8px_20px_rgba(34,197,94,0.30)] disabled:opacity-45'
              : 'border border-white/[0.08] bg-[#2a3048] text-white/40'
          }`}
        >
          {isPlayer ? (automatic ? 'Automatic' : 'Bingo') : isWatchingOnly ? 'Watching' : 'Bingo'}
        </button>
      </footer>
        </>
      )}
    </div>
  );
}
