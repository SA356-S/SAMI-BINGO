export function AmbientGlow() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-purple-900/20 blur-[100px]" />
      <div className="absolute bottom-40 -left-20 h-56 w-56 rounded-full bg-emerald-900/15 blur-[80px]" />
      <div className="absolute top-1/3 -right-16 h-48 w-48 rounded-full bg-amber-900/10 blur-[70px]" />
    </div>
  );
}

/** Home / Play screen background glow — matches design reference */
export function HomePlayAmbientGlow() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-[#6b21a8]/25 blur-[90px]" />
      <div className="absolute -right-24 top-1/4 h-48 w-48 rounded-full bg-[#4c1d95]/15 blur-[80px]" />
      <div className="absolute bottom-32 left-1/3 h-40 w-40 rounded-full bg-[#1e1b4b]/30 blur-[70px]" />
    </div>
  );
}

export default function PageShell({ children, withNav = true, className = '' }) {
  return (
    <div
      className={`relative min-h-[100dvh] bg-theme-navy font-sans text-white overflow-x-hidden ${className}`}
    >
      <AmbientGlow />
      <div
        className={`relative z-10 mx-auto max-w-md px-4 pt-5 ${
          withNav ? 'pb-28' : 'pb-8'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
