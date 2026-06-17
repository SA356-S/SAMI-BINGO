import { clearStaleAudioOnForeground, suspendGameAudioForBackground } from '../audio/gameSounds';
import { rebindGameAudioSync } from '../audio/gameAudioSync';
import { getSocket } from '../api/socket';
import {
  pauseLobbyLocalTimers,
  resyncLobbyFromServer,
  resumeLobbyLocalTimers,
} from '../services/lobbySession';
import { initTelegramWebApp } from '../utils/telegramWebApp';

const LOG_PREFIX = '[miniapp-lifecycle]';

let appSuspended = false;
let resyncInFlight = false;

function isMainGameRoute() {
  const path = window.location.pathname;
  return path === '/main-game' || path === '/game-75-ball';
}

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

function handleBackground() {
  if (appSuspended) return;
  if (document.visibilityState === 'visible') return;

  appSuspended = true;
  log('background — pausing local audio and timers');

  suspendGameAudioForBackground();
  pauseLobbyLocalTimers();
}

async function resyncActiveGameSession() {
  if (!isMainGameRoute()) return;

  const { fetchPlayerGameStatus } = await import('../api/gameSession');
  const status = await fetchPlayerGameStatus();
  if (!status || status.ok === false) return;

  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
    return;
  }

  log('foreground — refreshing in-game session via socket reconnect');
  socket.disconnect();
  socket.connect();
}

async function handleForeground() {
  if (!appSuspended) return;
  if (document.visibilityState === 'hidden') return;
  if (resyncInFlight) return;

  appSuspended = false;
  resyncInFlight = true;

  try {
    log('foreground — clearing stale audio and resyncing from server');

    clearStaleAudioOnForeground();
    resumeLobbyLocalTimers();
    rebindGameAudioSync();

    await resyncLobbyFromServer();
    await resyncActiveGameSession();
  } catch (err) {
    console.warn(LOG_PREFIX, 'foreground resync failed:', err?.message || err);
  } finally {
    resyncInFlight = false;
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    handleBackground();
  } else {
    void handleForeground();
  }
}

function onPageHide() {
  handleBackground();
}

function onPageShow() {
  void handleForeground();
}

function bindTelegramLifecycle(webApp) {
  if (!webApp?.onEvent) return () => {};

  const onDeactivated = () => handleBackground();
  const onActivated = () => {
    void handleForeground();
  };
  const onVisibilityChanged = (event) => {
    if (event?.is_visible === false) {
      handleBackground();
      return;
    }
    if (event?.is_visible === true) {
      void handleForeground();
    }
  };

  webApp.onEvent('deactivated', onDeactivated);
  webApp.onEvent('activated', onActivated);
  webApp.onEvent('visibility_changed', onVisibilityChanged);

  return () => {
    try {
      webApp.offEvent?.('deactivated', onDeactivated);
      webApp.offEvent?.('activated', onActivated);
      webApp.offEvent?.('visibility_changed', onVisibilityChanged);
    } catch {
      /* ignore */
    }
  };
}

/**
 * Mini App background/foreground handling — audio queues and local timers only.
 * @returns {() => void} cleanup
 */
export function initMiniAppLifecycle() {
  if (typeof window === 'undefined') return () => {};

  const webApp = initTelegramWebApp();
  const unbindTelegram = bindTelegramLifecycle(webApp);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    unbindTelegram();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}
