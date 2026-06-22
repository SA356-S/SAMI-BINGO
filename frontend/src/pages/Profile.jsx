import { useState, useEffect, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import Navbar from '../components/Navbar';
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
  clearSoundUserLock,
} from '../utils/soundSettings';
import { resetBallSoundQueue, unlockGameAudio } from '../audio/gameSounds';

const PROFILE_CARD =
  'rounded-[26px] border border-white/[0.06] bg-[#161b22] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

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

function WalletAmount({ amount, loading }) {
  return (
    <p className="mt-2.5 text-[1.75rem] font-bold leading-none tracking-tight text-white">
      {loading ? '…' : amount}
      <span className="ml-1.5 text-sm font-semibold text-sky-400">ETB</span>
    </p>
  );
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
  }, []);

  useEffect(() => {
    const initial = getSoundEffectsEnabled();
    setSoundOn(initial);
    setSoundEffectsEnabled(initial, { fromUser: true });

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
      clearSoundUserLock();
    };
  }, [applyProfile]);

  const handleSoundToggle = async () => {
    const next = !getSoundEffectsEnabled();
    setSoundEffectsEnabled(next, { fromUser: true });
    if (next) {
      unlockGameAudio();
    } else {
      resetBallSoundQueue();
    }
    try {
      await updateSoundEffects(getPlayerUserId(), next);
    } catch {
      const revert = !next;
      setSoundEffectsEnabled(revert, { fromUser: true });
    }
  };

  const displayUsername = authError
    ? 'Open in Telegram'
    : profileLoading && !username
      ? 'Loading…'
      : username || firstName || 'Player';

  const statCards = [
    { label: 'GAME WIN', value: gameWin, valueClass: 'text-amber-400' },
    { label: 'TOTAL INVITE', value: totalInvite, valueClass: 'text-sky-400' },
    { label: 'TOTAL EARNED', value: totalEarned, valueClass: 'text-emerald-400' },
  ];

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0b0e11] font-sans text-white">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 rounded-full bg-indigo-900/20 blur-[90px]" />
        <div className="absolute bottom-32 -left-16 h-44 w-44 rounded-full bg-violet-900/15 blur-[80px]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-3 pt-5 sm:px-4 sm:pt-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <section className="flex shrink-0 flex-col items-center text-center">
          <div className="rounded-[24px] bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 p-[3px] shadow-[0_0_32px_rgba(99,102,241,0.42)]">
            <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[21px] bg-[#0d1118] text-[2rem] font-bold text-white sm:h-[80px] sm:w-[80px] sm:text-[2.15rem]">
              {initial}
            </div>
          </div>

          <h2 className="mt-4 max-w-full truncate px-2 text-[1.35rem] font-bold tracking-tight text-white sm:text-2xl">
            {displayUsername}
          </h2>

          {telegramId ? (
            <p className="sr-only">Telegram ID {telegramId}</p>
          ) : null}

          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-300/85">
            {verified ? 'VERIFIED PLAYER' : 'PLAYER'}
          </p>
        </section>

        <section className="mt-5 grid shrink-0 grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3">
          <article className={`px-4 py-4 ${PROFILE_CARD}`}>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              MAIN WALLET
            </p>
            <WalletAmount amount={mainWallet} loading={profileLoading} />
            <p className="mt-2 text-[11px] italic text-emerald-400">Withdrawable</p>
          </article>

          <article className={`px-4 py-4 ${PROFILE_CARD}`}>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              PLAY WALLET
            </p>
            <WalletAmount amount={playWallet} loading={profileLoading} />
            <p className="mt-2 text-[11px] italic text-sky-400">Game Credits</p>
          </article>
        </section>

        <section className="mt-3 grid shrink-0 grid-cols-3 gap-2 sm:mt-3.5 sm:gap-2.5">
          {statCards.map(({ label, value, valueClass }) => (
            <article
              key={label}
              className={`flex flex-col items-center px-2 py-3.5 text-center ${PROFILE_CARD}`}
            >
              <p className="text-[8px] font-semibold uppercase leading-tight tracking-[0.12em] text-slate-500">
                {label}
              </p>
              <p
                className={`mt-2 text-[1.65rem] font-bold leading-none tabular-nums ${valueClass}`}
              >
                {profileLoading ? '…' : value}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-3 shrink-0 sm:mt-3.5">
          <div className={`flex items-center gap-3 px-4 py-3.5 ${PROFILE_CARD} rounded-[999px]`}>
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                soundOn
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-[0_0_18px_rgba(34,197,94,0.35)]'
                  : 'bg-white/[0.06] text-white/35'
              }`}
            >
              {soundOn ? (
                <Volume2 className="h-5 w-5" strokeWidth={2} />
              ) : (
                <VolumeX className="h-5 w-5" strokeWidth={2} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold uppercase tracking-[0.06em] text-white">
                SOUND EFFECTS
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Toggle game audio
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              aria-label="Toggle sound effects"
              onClick={handleSoundToggle}
              className={`relative h-8 w-14 shrink-0 touch-manipulation rounded-full transition ${
                soundOn
                  ? 'bg-emerald-500 shadow-[0_0_18px_rgba(34,197,94,0.55)]'
                  : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform ${
                  soundOn ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>
      </div>

      <Navbar activeScreen={activeScreen} onNavigate={onNavigate} embedded />
    </div>
  );
}
