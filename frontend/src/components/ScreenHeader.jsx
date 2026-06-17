const PAGE_TITLES = {
  scores: 'Scores',
  wallet: 'My Wallet',
  profile: 'Profile',
};

/** Invisible Rules button — keeps header height/width stable on non-home tabs */
function HeaderSpacer() {
  return (
    <span
      className="invisible shrink-0 rounded-full border border-transparent px-5 py-2.5 text-xs font-medium"
      aria-hidden="true"
    >
      Rules
    </span>
  );
}

function WalletHeaderRight({ phone, verified }) {
  const displayPhone = phone && String(phone).length > 0 ? phone : '—';

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      {verified !== false && (
        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[8px] font-bold tracking-wider text-emerald-400">
          VERIFIED
        </span>
      )}
      <span className="text-[10px] tabular-nums text-white/50">{displayPhone}</span>
    </div>
  );
}

export default function ScreenHeader({
  activeScreen,
  onNavigate,
  headerPhone,
  headerVerified,
}) {
  const isHome = activeScreen === 'home';
  const isWallet = activeScreen === 'wallet';
  const isHistory = activeScreen === 'history';
  const pageTitle = PAGE_TITLES[activeScreen];

  if (isHistory) {
    return null;
  }

  return (
    <header className="relative z-10 shrink-0 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="flex min-h-[40px] w-full min-w-0 items-center justify-between gap-2 sm:min-h-[42px]">
        {isHome ? (
          <>
            <span className="truncate text-sm font-bold tracking-[0.14em] text-white/90 sm:text-base sm:tracking-[0.18em]">
              EDIL BINGO
            </span>
            <button
              type="button"
              onClick={() => onNavigate('rules')}
              className="shrink-0 touch-manipulation rounded-full border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium tracking-wide text-white/80 backdrop-blur-sm transition hover:border-white/35 hover:bg-white/10 sm:px-5 sm:py-2.5"
            >
              Rules
            </button>
          </>
        ) : (
          <>
            <h1 className="min-w-0 shrink truncate text-xs font-semibold tracking-wide text-white/90 sm:text-sm">
              {pageTitle}
            </h1>
            {isWallet ? (
              <WalletHeaderRight
                phone={headerPhone}
                verified={headerVerified}
              />
            ) : (
              <HeaderSpacer />
            )}
          </>
        )}
      </div>
    </header>
  );
}
