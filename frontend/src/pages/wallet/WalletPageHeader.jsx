export default function WalletPageHeader({ phone, verified }) {
  const displayPhone = phone && String(phone).length > 0 ? phone : '—';

  return (
    <header className="shrink-0 pb-3 pt-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-bold uppercase tracking-[0.14em] text-white sm:text-[15px]">
            My Wallet
          </h1>
          <p className="mt-1 text-[11px] font-medium tabular-nums tracking-wide text-slate-400">
            {displayPhone}
          </p>
        </div>

        {verified !== false ? (
          <span className="shrink-0 rounded-md border border-sky-400/35 bg-sky-500/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-sky-300">
            VERIFIED
          </span>
        ) : null}
      </div>
    </header>
  );
}
