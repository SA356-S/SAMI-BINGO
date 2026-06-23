import { suspendGameAudioForBackground } from '../audio/gameSounds';
import { pauseLobbyLocalTimers } from '../services/lobbySession';
import { resumeGameSession } from '../services/gameSessionLifecycle';
import { initTelegramWebApp } from '../utils/telegramWebApp';

const LOG_PREFIX = '[miniapp-lifecycle]';

/** Skip fallback verify on cold-start pageshow; bootstrap already syncs. */
const FOREGROUND_VERIFY_MIN_MS = 2500;

let appSuspended = false;
let lifecycleInitAt = 0;

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

function handleForeground() {
  if (document.visibilityState === 'hidden') return;

  const hadSuspendedFlag = appSuspended;
  appSuspended = false;

  if (!hadSuspendedFlag) {
    const sinceInit = lifecycleInitAt ? Date.now() - lifecycleInitAt : 0;
    if (sinceInit < FOREGROUND_VERIFY_MIN_MS) {
      return;
    }
    log('foreground — snapshot verify (no background flag)');
  } else {
    log('foreground — resume from background');
  }

  void resumeGameSession();
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    handleBackground();
  } else {
    handleForeground();
  }
}

function onPageHide() {
  handleBackground();
}

function onPageShow() {
  handleForeground();
}

function bindTelegramLifecycle(webApp) {
  if (!webApp?.onEvent) return () => {};

  const onDeactivated = () => handleBackground();
  const onActivated = () => handleForeground();
  const onVisibilityChanged = (event) => {
    if (event?.is_visible === false) {
      handleBackground();
      return;
    }
    if (event?.is_visible === true) {
      handleForeground();
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
 * Mini App background/foreground — delegates resume to resumeGameSession().
 * @returns {() => void} cleanup
 */
export function initMiniAppLifecycle() {
  if (typeof window === 'undefined') return () => {};

  lifecycleInitAt = Date.now();
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
