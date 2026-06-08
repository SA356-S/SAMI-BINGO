import { NAV_ICON_MAP } from './NavIcons';

const NAV_ITEMS = [
  { screen: 'home', label: 'GAME' },
  { screen: 'scores', label: 'SCORES' },
  { screen: 'history', label: 'HISTORY' },
  { screen: 'wallet', label: 'WALLET' },
  { screen: 'profile', label: 'PROFILE' },
];

const NAV_BASE =
  'fixed bottom-0 left-0 z-50 grid w-full max-w-[100vw] grid-cols-5 items-end border-t border-white/[0.08] bg-[#0b1220] px-0.5 pt-0.5';

function NavTabButton({ screen, label, active, onNavigate }) {
  const Icon = NAV_ICON_MAP[screen];

  return (
    <button
      type="button"
      onClick={() => onNavigate(screen)}
      className="relative flex min-h-[34px] w-full touch-manipulation flex-col items-center justify-end gap-0.5 pb-0 sm:gap-0.5"
    >
      <span className="relative flex w-full flex-col items-center">
        {active ? (
          <span
            className="mb-1 h-[3px] w-8 shrink-0 rounded-full bg-[#4ade80] shadow-[0_0_10px_rgba(74,222,128,0.9)] transition-all duration-200 ease-out"
            aria-hidden="true"
          />
        ) : (
          <span className="mb-1 h-[3px] w-8 shrink-0" aria-hidden="true" />
        )}

        <span className="relative flex h-8 w-8 items-center justify-center">
          <span
            className={`pointer-events-none absolute -inset-2 rounded-full transition-opacity duration-200 ease-out ${
              active
                ? 'bg-[radial-gradient(circle_at_50%_15%,rgba(74,222,128,0.5)_0%,rgba(34,197,94,0.18)_42%,transparent_72%)] opacity-100 blur-md'
                : 'opacity-0'
            }`}
            aria-hidden="true"
          />
          <span
            className={`pointer-events-none absolute inset-0 rounded-full transition-opacity duration-200 ease-out ${
              active
                ? 'bg-green-400/15 blur-lg opacity-100'
                : 'opacity-0'
            }`}
            aria-hidden="true"
          />
          <Icon className="relative h-8 w-8 shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
        </span>
      </span>

      <span
        className={`text-[8px] font-bold leading-none tracking-[0.14em] transition-colors duration-200 ease-out ${
          active
            ? 'text-[#4ade80] drop-shadow-[0_0_8px_rgba(74,222,128,0.8)]'
            : 'text-[#b8c4d0]'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export default function Navbar({
  activeScreen,
  onNavigate,
  embedded = false,
}) {
  const bottomPad =
    'pb-[calc(0.125rem+env(safe-area-inset-bottom))]';

  const navClass = embedded
    ? `z-20 w-full shrink-0 ${NAV_BASE} ${bottomPad}`
    : `${NAV_BASE} ${bottomPad}`;

  return (
    <nav className={navClass} aria-label="Main navigation">
      {NAV_ITEMS.map(({ screen, label }) => (
        <NavTabButton
          key={screen}
          screen={screen}
          label={label}
          active={activeScreen === screen}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
