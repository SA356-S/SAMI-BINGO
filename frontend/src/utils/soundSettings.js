const STORAGE_KEY = 'edil_bingo_sound_effects';
export const SOUND_EFFECTS_EVENT = 'edil:sound-effects-changed';

/** In-memory cache — avoids localStorage lag in Telegram WebView during playback. */
let cachedEnabled = null;

/** When set, blocks server/profile sync from overriding the user's explicit choice. */
let userLockedValue = null;

/** Read persisted sound preference (defaults to on). */
export function getSoundEffectsEnabled() {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) {
    cachedEnabled = true;
    return true;
  }
  cachedEnabled = stored === 'true';
  return cachedEnabled;
}

/**
 * Persist locally and notify listeners (Profile, MainGame, audio engine).
 * Pass fromUser: true when the player toggles sound so profile/socket sync cannot revert it.
 */
export function setSoundEffectsEnabled(enabled, { persistLocal = true, fromUser = false } = {}) {
  const value = Boolean(enabled);

  if (fromUser) {
    userLockedValue = value;
  } else if (userLockedValue !== null && value !== userLockedValue) {
    return userLockedValue;
  }

  cachedEnabled = value;
  if (typeof window !== 'undefined' && persistLocal) {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(SOUND_EFFECTS_EVENT, { detail: { enabled: value } })
    );
  }
  return value;
}

/** Release user lock when leaving Profile (other screens may sync from server). */
export function clearSoundUserLock() {
  userLockedValue = null;
}

export function subscribeSoundEffects(onChange) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => {
    onChange(event.detail?.enabled ?? getSoundEffectsEnabled());
  };
  window.addEventListener(SOUND_EFFECTS_EVENT, handler);
  return () => window.removeEventListener(SOUND_EFFECTS_EVENT, handler);
}

/** Gate for ball call, bingo, and notification sounds. */
export function shouldPlayGameSound() {
  return getSoundEffectsEnabled();
}
