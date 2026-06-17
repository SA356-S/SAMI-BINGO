import Navbar from './Navbar';
import { AmbientGlow } from './PageShell';
import ScreenHeader from './ScreenHeader';

/**
 * Fixed full-screen shell shared across all main tab screens.
 */
export default function ScreenLayout({
  activeScreen,
  onNavigate,
  children,
  contentVariant = 'centered',
  headerPhone,
  headerVerified,
}) {
  const contentClasses =
    contentVariant === 'fill'
      ? 'items-stretch justify-start gap-2 overflow-hidden sm:gap-3'
      : 'items-center justify-center gap-y-4 overflow-hidden sm:gap-y-6';

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col justify-between overflow-hidden bg-theme-navy font-sans text-white">
      <AmbientGlow />

      <ScreenHeader
        activeScreen={activeScreen}
        onNavigate={onNavigate}
        headerPhone={headerPhone}
        headerVerified={headerVerified}
      />

      <div
        className={`relative z-10 flex min-h-0 w-full flex-grow flex-col px-3 sm:px-4 ${contentClasses}`}
      >
        {children}
      </div>

      <div
        className="shrink-0 h-[calc(2.75rem+env(safe-area-inset-bottom,0px))] sm:h-[3rem]"
        aria-hidden="true"
      />

      <Navbar activeScreen={activeScreen} onNavigate={onNavigate} embedded />
    </div>
  );
}

/** Shared glass card used for centered page content */
export function ContentCard({ children, className = '' }) {
  return (
    <div
      className={`w-full max-w-sm shrink-0 rounded-3xl border border-white/[0.08] bg-white/[0.04] px-5 py-8 text-center shadow-[0_0_40px_rgba(16,185,129,0.06),0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md sm:px-8 sm:py-10 ${className}`}
    >
      {children}
    </div>
  );
}
