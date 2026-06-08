const STORAGE_KEY = 'edil_bingo_sound_effects';
export const SOUND_EFFECTS_EVENT = 'edil:sound-effects-changed';

/** In-memory cache — avoids localStorage lag in Telegram WebView during playback. */
let cachedEnabled = null;

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
 */
export function setSoundEffectsEnabled(enabled, { persistLocal = true } = {}) {
  const value = Boolean(enabled);
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
