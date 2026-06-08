import { useState, useEffect, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import ScreenLayout from '../components/ScreenLayout';
import {
  getPlayerUserId,
  getTelegramUser,
  formatTelegramUsername,
} from '../api/playerIdentity';
import {
  fetchProfile,
  updateSoundEffects,
  subscribeProfileUpdates,
} from '../api/profile';
import { subscribeWalletUpdates } from '../api/wallet';
import { subscribeStatsUpdates } from '../api/stats';
import {
  getSoundEffectsEnabled,
  setSoundEffectsEnabled,
  subscribeSoundEffects,
} from '../utils/soundSettings';
import { resetBallSoundQueue, unlockGameAudio } from '../audio/gameSounds';

function readLocalTelegramIdentity() {
  const user = getTelegramUser();
  const username = formatTelegramUsername(user);
  const firstName = user?.first_name ? String(user.first_name).trim() : '';
  const telegramId = user?.id != null ? String(user.id) : '';
  const initial = (username.replace(/^@/, '') || firstName || 'P')
    .charAt(0)
    .toUpperCase();
  return { username, firstName, telegramId, initial };
}

export default function Profile({ activeScreen, onNavigate }) {
  const localIdentity = readLocalTelegramIdentity();
  const [username, setUsername] = useState(localIdentity.username);
  const [firstName, setFirstName] = useState(localIdentity.firstName);
  const [telegramId, setTelegramId] = useState(localIdentity.telegramId);
  const [initial, setInitial] = useState(localIdentity.initial);
  const [profileLoading, setProfileLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [verified, setVerified] = useState(false);
  const [mainWallet, setMainWallet] = useState(0);
  const [playWallet, setPlayWallet] = useState(0);
  const [gameWin, setGameWin] = useState(0);
  const [totalInvite, setTotalInvite] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [soundOn, setSoundOn] = useState(() => getSoundEffectsEnabled());

  const applyProfile = useCallback((data) => {
    setProfileLoading(false);
    setAuthError(Boolean(data.authError));
    if (data.loadError) return;
    if (data.username) setUsername(data.username);
    if (data.firstName) setFirstName(data.firstName);
    if (data.telegramId) setTelegramId(String(data.telegramId));
    if (data.initial) setInitial(data.initial);
    setVerified(data.verified === true);
    setMainWallet(data.mainWallet ?? 0);
    setPlayWallet(data.playWallet ?? 0);
    setGameWin(data.gameWin ?? data.totalWins ?? 0);
    setTotalInvite(data.totalInvite ?? 0);
    setTotalEarned(data.totalEarned ?? 0);
    if (typeof data.soundEffectsEnabled === 'boolean') {
      setSoundOn(data.soundEffectsEnabled);
      setSoundEffectsEnabled(data.soundEffectsEnabled);
    }
  }, []);

  useEffect(() => {
    const userId = getPlayerUserId();
    fetchProfile(userId).then(applyProfile);

    const unsubProfile = subscribeProfileUpdates(userId, applyProfile);
    const unsubWallet = subscribeWalletUpdates(userId, (wallet) => {
      setMainWallet(wallet.mainWallet);
      setPlayWallet(wallet.playWallet);
    });
    const unsubStats = subscribeStatsUpdates(() => {
      fetchProfile(userId).then(applyProfile);
    });
    const unsubSound = subscribeSoundEffects(setSoundOn);

    return () => {
      unsubProfile();
      unsubWallet();
      unsubStats();
      unsubSound();
    };
  }, [applyProfile]);

  const handleSoundToggle = async () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEffectsEnabled(next);
    if (next) {
      unlockGameAudio();
    } else {
      resetBallSoundQueue();
    }
    try {
      await updateSoundEffects(getPlayerUserId(), next);
    } catch {
      const revert = !next;
      setSoundOn(revert);
      setSoundEffectsEnabled(revert);
    }
  };

  return (
    <ScreenLayout
      activeScreen={activeScreen}
      onNavigate={onNavigate}
      contentVariant="fill"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* User identity */}
        <section className="shrink-0 flex flex-col items-center pt-1 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-2xl font-bold text-white shadow-[0_8px_24px_rgba(99,102,241,0.4)] sm:h-20 sm:w-20 sm:text-3xl">
            {initial}
          </div>
          <h2 className="mt-3 max-w-full truncate px-2 text-lg font-bold text-white sm:text-xl">
            {authError
              ? 'Open in Telegram'
              : profileLoading && !username
                ? 'Loading…'
                : username || 'Player'}
          </h2>
          {firstName ? (
            <p className="mt-1 max-w-full truncate px-2 text-xs text-white/55">
              {firstName}
            </p>
          ) : null}
          {telegramId ? (
            <p className="mt-0.5 text-[10px] tabular-nums text-white/35">
              ID {telegramId}
            </p>
          ) : null}
          <p className="mt-1 text-[10px] font-semibold tracking-[0.18em] text-slate-400">
            {verified ? 'VERIFIED PLAYER' : 'PLAYER'}
          </p>
        </section>

        {/* Wallet balances */}
        <section className="shrink-0 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-3">
            <p className="text-[9px] font-semibold tracking-[0.12em] text-white/45">
              MAIN WALLET
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-white">
              {mainWallet} ETB
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-emerald-400">
              Withdrawable
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-3">
            <p className="text-[9px] font-semibold tracking-[0.12em] text-white/45">
              PLAY WALLET
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-white">
              {playWallet} ETB
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-blue-400">
              Game Credits
            </p>
          </div>
        </section>

        {/* Performance stats */}
        <section className="shrink-0 grid grid-cols-3 gap-2">
          {[
            { label: 'GAME WIN', value: gameWin },
            { label: 'TOTAL INVITE', value: totalInvite },
            { label: 'TOTAL EARNED', value: totalEarned },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] px-1 py-3"
            >
              <p className="text-lg font-bold tabular-nums text-white">{value}</p>
              <p className="mt-1 text-center text-[8px] font-semibold leading-tight tracking-wide text-white/40">
                {label}
              </p>
            </div>
          ))}
        </section>

        {/* Sound effects */}
        <section className="shrink-0 pb-1">
          <div
            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
              soundOn
                ? 'border-emerald-500/35 bg-emerald-500/10 shadow-[0_0_24px_rgba(16,185,129,0.15)]'
                : 'border-white/[0.08] bg-white/[0.03]'
            }`}
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                soundOn
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-white/5 text-white/35'
              }`}
            >
              {soundOn ? (
                <Volume2 className="h-5 w-5" strokeWidth={2} />
              ) : (
                <VolumeX className="h-5 w-5" strokeWidth={2} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-semibold ${
                  soundOn ? 'text-white' : 'text-white/60'
                }`}
              >
                SOUND EFFECTS
              </p>
              <p className="text-[11px] text-white/40">
                Amharic number calls &amp; game audio
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              aria-label="Toggle sound effects"
              onClick={handleSoundToggle}
              className={`relative h-7 w-12 shrink-0 touch-manipulation rounded-full transition ${
                soundOn ? 'bg-emerald-500' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-transform ${
                  soundOn ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>
      </div>
    </ScreenLayout>
  );
}
