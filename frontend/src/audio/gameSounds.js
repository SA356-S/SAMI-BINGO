import { getBingoLetter } from '../utils/bingoBall';
import {
  shouldPlayGameSound,
  subscribeSoundEffects,
} from '../utils/soundSettings';
import { initTelegramWebApp } from '../utils/telegramWebApp';

/** Vite serves clips at `/sounds/{letter}-{n}.mp3` */
export const SOUNDS_BASE_PATH = '/sounds';

export const BINGO_SOUND_URL = `${SOUNDS_BASE_PATH}/bingo.mp3`;
export const GAME_START_SOUND_URL = `${SOUNDS_BASE_PATH}/start.mp3`;
export const COUNTDOWN_TICK_SOUND_URL = `${SOUNDS_BASE_PATH}/tick.mp3`;

const MIN_BALL = 1;
const MAX_BALL = 75;

const LOG_PREFIX = '[bingo-audio]';
const DEBUG =
  import.meta.env.DEV || import.meta.env.VITE_AUDIO_DEBUG === 'true';

const PLAY_TIMEOUT_MS = 8000;

/** UI animation time after a ball sound before bingo validation / winner splash */
export const BALL_REVEAL_ANIMATION_MS = 400;

/** e.g. ball 46 → `g-46.mp3`, ball 12 → `b-12.mp3` */
export function ballFileName(number) {
  const n = Math.floor(Number(number));
  const letter = getBingoLetter(n).toLowerCase();
  return `${letter}-${n}.mp3`;
}

/** @type {Map<number, HTMLAudioElement>} */
const ballAudioCache = new Map();

/** @type {Promise<{ ok: number; missing: number[]; preloaded: number }> | null>} */
let preloadPromise = null;

/** @type {HTMLAudioElement | null} */
let activeAudio = null;

/** @type {HTMLAudioElement | null} */
let bingoAudio = null;

let bingoWinPlayed = false;
let ballSoundsSuppressed = false;

let cacheInitialized = false;
let audioUnlocked = false;

/** @type {{ number: number; source: string; onComplete?: (ok: boolean) => void }[]} */
const ballPlayQueue = [];
let queueProcessing = false;
let lastQueuedBall = null;

/** Balls already announced this round (skip replay; rejoin sync marks past balls) */
const announcedBalls = new Set();

function log(...args) {
  if (DEBUG) console.log(LOG_PREFIX, ...args);
}

function logInfo(...args) {
  console.log(LOG_PREFIX, ...args);
}

function warn(...args) {
  console.warn(LOG_PREFIX, ...args);
}

export function ballUrl(number) {
  return `${SOUNDS_BASE_PATH}/${ballFileName(number)}`;
}

function ensureBallCache() {
  if (cacheInitialized) return;
  cacheInitialized = true;

  try {
    for (let n = MIN_BALL; n <= MAX_BALL; n += 1) {
      if (!ballAudioCache.has(n)) {
        const url = ballUrl(n);
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = 1;
        audio.muted = false;
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        ballAudioCache.set(n, audio);
      }
    }
    logInfo(
      `cache ready (${ballAudioCache.size} clips) — pattern ${SOUNDS_BASE_PATH}/{b|i|n|g|o}-{n}.mp3`
    );
  } catch (err) {
    warn('cache init failed (game continues):', err?.message || err);
  }
}

function getBallAudio(number) {
  ensureBallCache();
  const n = Math.floor(Number(number));
  if (!Number.isFinite(n) || n < MIN_BALL || n > MAX_BALL) return null;
  return ballAudioCache.get(n) ?? null;
}

/** Fresh element per play — avoids Telegram WebView stutter on reused nodes. */
function createPlaybackAudio(number) {
  const n = Math.floor(Number(number));
  if (!Number.isFinite(n) || n < MIN_BALL || n > MAX_BALL) return null;
  const url = ballUrl(n);
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = 1;
  audio.muted = false;
  audio.setAttribute('playsinline', 'true');
  audio.setAttribute('webkit-playsinline', 'true');
  return audio;
}

async function verifyFileExists(number) {
  const url = ballUrl(number);
  try {
    let res = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
    if (!res.ok) {
      res = await fetch(url, { method: 'GET', cache: 'force-cache' });
    }
    return res.ok;
  } catch (err) {
    warn(`verify failed ${url}:`, err?.message || err);
    return false;
  }
}

export async function unlockGameAudio() {
  if (audioUnlocked) return true;

  initTelegramWebApp();
  ensureBallCache();
  const audio = createPlaybackAudio(1) ?? getBallAudio(1);
  if (!audio) return false;

  try {
    audio.volume = 0.001;
    audio.muted = false;
    audio.currentTime = 0;
    await audio.play().catch((err) => {
      console.log('[bingo-audio] unlock play blocked:', err?.message || err);
      throw err;
    });
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1;
    audioUnlocked = true;
    logInfo('audio unlocked via', ballUrl(1));
    return true;
  } catch (err) {
    warn('audio unlock failed (tap once):', err?.message || err);
    return false;
  }
}

/** Unlock + preload once when entering a live round. */
export async function prepareGameAudioForRound() {
  ensureBallCache();
  await unlockGameAudio();
  try {
    await preloadBallCallSounds();
  } catch (err) {
    console.log('[bingo-audio] preload skipped:', err?.message || err);
  }
}

export function isGameAudioUnlocked() {
  return audioUnlocked;
}

export function preloadBallCallSounds() {
  if (preloadPromise) return preloadPromise;

  preloadPromise = (async () => {
    ensureBallCache();
    let preloaded = 0;

    await Promise.all(
      Array.from(ballAudioCache.entries(), async ([num, audio]) => {
        return new Promise((resolve) => {
          const finish = () => {
            audio.removeEventListener('canplaythrough', finish);
            audio.removeEventListener('error', onErr);
            preloaded += 1;
            resolve();
          };
          const onErr = () => {
            audio.removeEventListener('canplaythrough', finish);
            audio.removeEventListener('error', onErr);
            resolve();
          };
          if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            preloaded += 1;
            resolve();
            return;
          }
          audio.addEventListener('canplaythrough', finish, { once: true });
          audio.addEventListener('error', onErr, { once: true });
          audio.load();
        });
      })
    );

    try {
      const bingo = getBingoAudio();
      bingo.load();
    } catch (err) {
      warn('bingo preload failed:', err?.message || err);
    }

    logInfo(`preload complete: ${preloaded}/${MAX_BALL} buffered`);
    return { ok: preloaded, missing: [], preloaded };
  })();

  return preloadPromise;
}

function stopActiveAudio() {
  if (!activeAudio) return;
  try {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
  activeAudio = null;
}

function clearBallQueue() {
  while (ballPlayQueue.length > 0) {
    const item = ballPlayQueue.shift();
    item?.onComplete?.(false);
  }
  lastQueuedBall = null;
}

export function syncAnnouncedBallsFromHistory(balls = []) {
  announcedBalls.clear();
  if (!Array.isArray(balls)) return;
  for (const raw of balls) {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= MIN_BALL && n <= MAX_BALL) {
      announcedBalls.add(n);
    }
  }
}

export function hasAnnouncedBall(number) {
  const n = Math.floor(Number(number));
  return Number.isFinite(n) && announcedBalls.has(n);
}

export function markBallAnnounced(number) {
  const n = Math.floor(Number(number));
  if (Number.isFinite(n) && n >= MIN_BALL && n <= MAX_BALL) {
    announcedBalls.add(n);
  }
}

export function unmarkBallAnnounced(number) {
  const n = Math.floor(Number(number));
  if (Number.isFinite(n)) {
    announcedBalls.delete(n);
  }
}

export function resetAnnouncedBalls() {
  announcedBalls.clear();
}

function playOneShot(audio, label) {
  return new Promise((resolve) => {
    if (!audio) {
      resolve(false);
      return;
    }

    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeAudio === audio) activeAudio = null;
      resolve(ok);
    };

    const timer = setTimeout(() => {
      warn(`playback timeout: ${label}`);
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      done(false);
    }, PLAY_TIMEOUT_MS);

    activeAudio = audio;
    audio.volume = 1;
    audio.muted = false;

    const onEnded = () => done(true);
    const onError = () => {
      warn(`playback error: ${label}`);
      done(false);
    };

    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onError, { once: true });

    const start = () => {
      audio
        .play()
        .then(() => {
          logInfo(`playback start: ${label}`);
        })
        .catch((err) => {
          warn(`playback blocked: ${label} —`, err?.message || err);
          done(false);
        });
    };

    try {
      audio.pause();
      audio.currentTime = 0;
      start();
    } catch (err) {
      warn(`playback failed: ${label} —`, err?.message || err);
      done(false);
    }
  });
}

async function playBallCallSoundImmediate(number, source) {
  const n = Math.floor(Number(number));
  logInfo('announcer playing clip', { ball: n, source, label: formatBallCall(n) });
  if (!shouldPlayGameSound() || ballSoundsSuppressed || bingoWinPlayed) {
    return false;
  }

  if (!audioUnlocked) {
    const unlocked = await unlockGameAudio();
    if (!unlocked) {
      console.log('[bingo-audio] still locked — tap screen to enable sound');
    }
  }

  const audio = createPlaybackAudio(n);
  if (!audio) {
    warn(`no audio for ball ${n}`);
    return false;
  }

  return playOneShot(audio, `${formatBallCall(n)} (${source})`);
}

async function drainBallQueue() {
  if (queueProcessing) return;
  queueProcessing = true;

  while (ballPlayQueue.length > 0) {
    if (!shouldPlayGameSound() || ballSoundsSuppressed || bingoWinPlayed) {
      clearBallQueue();
      break;
    }

    const item = ballPlayQueue.shift();
    if (!item) continue;

    const ok = await playBallCallSoundImmediate(item.number, item.source);
    if (ok) {
      announcedBalls.add(item.number);
      item.onComplete?.(true);
    } else if (!audioUnlocked) {
      ballPlayQueue.unshift(item);
      item.onComplete?.(false);
      break;
    } else {
      item.onComplete?.(false);
    }
  }

  queueProcessing = false;
  if (ballPlayQueue.length === 0) {
    lastQueuedBall = null;
  }
}

function enqueueBallCall(number, source, onComplete, forceLive = false) {
  const n = Math.floor(Number(number));
  if (!Number.isFinite(n) || n < MIN_BALL || n > MAX_BALL) {
    onComplete?.(false);
    return;
  }

  if (!forceLive && announcedBalls.has(n)) {
    log(`skip already announced ${formatBallCall(n)} (${source})`);
    onComplete?.(true);
    return;
  }

  if (ballPlayQueue.some((item) => item.number === n)) {
    if (onComplete) {
      const existing = ballPlayQueue.find((item) => item.number === n);
      const prevComplete = existing?.onComplete;
      if (existing) {
        existing.onComplete = (ok) => {
          prevComplete?.(ok);
          onComplete(ok);
        };
      }
    }
    return;
  }

  if (ballPlayQueue.length > 0 && ballPlayQueue[ballPlayQueue.length - 1].number === n) {
    if (onComplete) {
      const last = ballPlayQueue[ballPlayQueue.length - 1];
      const prevComplete = last.onComplete;
      last.onComplete = (ok) => {
        prevComplete?.(ok);
        onComplete(ok);
      };
    }
    return;
  }

  ballPlayQueue.push({ number: n, source, onComplete });
  lastQueuedBall = n;

  drainBallQueue().catch((err) => {
    warn('queue drain failed:', err?.message || err);
    queueProcessing = false;
    onComplete?.(false);
  });
}

/** Play one ball call and resolve when the clip finishes (or fails). */
export function playBallCallSoundAndWait(
  number,
  { source = 'socket', forceLive = false } = {}
) {
  return new Promise((resolve) => {
    if (ballSoundsSuppressed || bingoWinPlayed) {
      resolve(false);
      return;
    }
    if (!shouldPlayGameSound()) {
      log(`skip wait ball ${number} — sound OFF (${source})`);
      const n = Math.floor(Number(number));
      if (Number.isFinite(n) && n >= MIN_BALL && n <= MAX_BALL) {
        announcedBalls.add(n);
      }
      resolve(true);
      return;
    }

    const n = Math.floor(Number(number));
    if (!Number.isFinite(n) || n < MIN_BALL || n > MAX_BALL) {
      resolve(false);
      return;
    }

    if (!forceLive && announcedBalls.has(n)) {
      logInfo('announcer skip — already in announced set', { ball: n, source });
      resolve(true);
      return;
    }

    logInfo('announcer enqueue', { ball: n, source });
    enqueueBallCall(n, source, resolve, forceLive);
  });
}

/** True while a ball-call clip is queued or actively playing (not bingo). */
function isBallAnnouncementBusy() {
  if (queueProcessing || ballPlayQueue.length > 0) return true;
  if (activeAudio && activeAudio !== bingoAudio) return true;
  return false;
}

/** Wait until all queued ball sounds have finished playing. */
export function waitForBallAnnouncementIdle() {
  return new Promise((resolve) => {
    const poll = () => {
      if (!isBallAnnouncementBusy()) {
        resolve();
        return;
      }
      setTimeout(poll, 40);
    };
    poll();
  });
}

/** Let the final ball finish, then play the room bingo cue once. */
export async function playBingoWinSoundAfterBallsIdle() {
  await waitForBallAnnouncementIdle();
  await playBingoWinSound();
}

function formatBallCall(num) {
  return `${getBingoLetter(num)}-${num}`;
}

function getBingoAudio() {
  if (!bingoAudio) {
    bingoAudio = new Audio(BINGO_SOUND_URL);
    bingoAudio.preload = 'auto';
    bingoAudio.volume = 1;
    bingoAudio.muted = false;
    bingoAudio.setAttribute('playsinline', 'true');
    bingoAudio.setAttribute('webkit-playsinline', 'true');
  }
  return bingoAudio;
}

export function resetBingoWinSound() {
  bingoWinPlayed = false;
  ballSoundsSuppressed = false;
  if (bingoAudio) {
    try {
      bingoAudio.pause();
      bingoAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    if (activeAudio === bingoAudio) activeAudio = null;
  }
}

export async function playGameStartSound() {
  try {
    if (!shouldPlayGameSound()) return;
    if (!audioUnlocked) {
      const unlocked = await unlockGameAudio();
      if (!unlocked) return;
    }
    const audio = new Audio(GAME_START_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 1;
    audio.muted = false;
    audio.setAttribute('playsinline', 'true');
    await playOneShot(audio, `game-start — ${GAME_START_SOUND_URL}`);
  } catch (err) {
    log('game start sound skipped:', err?.message || err);
  }
}

export async function playCountdownTickSound(seconds) {
  const sec = Math.floor(Number(seconds));
  if (!Number.isFinite(sec) || sec <= 0 || sec > 5) return;
  if (!shouldPlayGameSound()) return;

  if (!audioUnlocked) {
    const unlocked = await unlockGameAudio();
    if (!unlocked) return;
  }

  try {
    const audio = new Audio(COUNTDOWN_TICK_SOUND_URL);
    audio.preload = 'auto';
    audio.volume = 1;
    audio.muted = false;
    audio.setAttribute('playsinline', 'true');
    await playOneShot(audio, `countdown-${sec}`);
  } catch (err) {
    log('countdown tick skipped:', err?.message || err);
  }
}

export async function playBingoWinSound() {
  try {
    if (!shouldPlayGameSound()) {
      log('skip bingo.mp3 — sound OFF');
      return;
    }
    if (bingoWinPlayed) return;

    clearBallQueue();
    stopActiveAudio();
    bingoWinPlayed = true;
    ballSoundsSuppressed = true;

    if (!audioUnlocked) {
      const unlocked = await unlockGameAudio();
      if (!unlocked) {
        bingoWinPlayed = false;
        ballSoundsSuppressed = false;
        return;
      }
    }

    const audio = getBingoAudio();
    await playOneShot(audio, `bingo — ${BINGO_SOUND_URL}`);
  } catch (err) {
    warn('playBingoWinSound failed (game continues):', err?.message || err);
  }
}

export function playBallCallSound(number, { source = 'manual' } = {}) {
  try {
    if (ballSoundsSuppressed || bingoWinPlayed) return;

    if (!shouldPlayGameSound()) {
      log(`skip ball ${number} — sound OFF (${source})`);
      return;
    }

    const n = Math.floor(Number(number));
    if (!Number.isFinite(n) || n < MIN_BALL || n > MAX_BALL) {
      warn(`invalid ball number: ${number}`);
      return;
    }

    log(`queue ${formatBallCall(n)} (${source})`);
    enqueueBallCall(n, source);
  } catch (err) {
    warn('playBallCallSound failed (game continues):', err?.message || err);
  }
}

/** Unified ball sound entry — same path for every ball including the first. */
export function playBallSound(number, options = {}) {
  playBallCallSound(number, options);
}

export function resetBallSoundQueue() {
  stopActiveAudio();
  clearBallQueue();
  queueProcessing = false;
  resetAnnouncedBalls();
  if (!bingoWinPlayed) ballSoundsSuppressed = false;
}

export function resolveBallNumberFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const direct = Number(
    payload.number ?? payload.ball ?? payload.latestBall ?? payload.latest
  );
  if (Number.isFinite(direct) && direct >= MIN_BALL && direct <= MAX_BALL) {
    return direct;
  }

  const list =
    payload.calledNumbers ??
    payload.called ??
    payload.balls ??
    payload.calledHistory;

  if (Array.isArray(list) && list.length > 0) {
    const last = Number(list[list.length - 1]);
    if (Number.isFinite(last) && last >= MIN_BALL && last <= MAX_BALL) {
      return last;
    }
  }

  return null;
}

export function announceBallFromPayload(payload, source = 'socket') {
  const ball = resolveBallNumberFromPayload(payload);
  if (ball == null) {
    log(`no ball in payload (${source})`, payload);
    return null;
  }
  playBallCallSound(ball, { source });
  return { ball };
}

export function bindAudioUnlockOnInteraction() {
  if (typeof window === 'undefined') return () => {};

  const handler = () => {
    unlockGameAudio();
  };

  const opts = { passive: true };
  const events = ['pointerdown', 'touchstart', 'click'];
  events.forEach((ev) => window.addEventListener(ev, handler, opts));

  try {
    initTelegramWebApp();
    window.Telegram?.WebApp?.onEvent?.('viewportChanged', handler);
  } catch {
    /* ignore */
  }

  return () => {
    events.forEach((ev) => window.removeEventListener(ev, handler));
    try {
      window.Telegram?.WebApp?.offEvent?.('viewportChanged', handler);
    } catch {
      /* ignore */
    }
  };
}

export async function playGameSound(category, id) {
  if (category === 'ball') {
    playBallCallSound(id);
  } else if (category === 'bingo') {
    await playBingoWinSound();
  }
}

if (typeof window !== 'undefined') {
  subscribeSoundEffects((enabled) => {
    if (!enabled) resetBallSoundQueue();
    else unlockGameAudio();
  });
}
