import { Gamepad2, Trophy } from 'lucide-react';

function BalanceCard({ label, amount, tone }) {
  const isMain = tone === 'main';

  const shellClass = isMain
    ? 'border-emerald-400/20 bg-gradient-to-br from-[#0d1f1a] via-[#0a1814] to-[#071210] shadow-[0_0_28px_rgba(16,185,129,0.22)]'
    : 'border-violet-400/20 bg-gradient-to-br from-[#151028] via-[#120d22] to-[#0c0818] shadow-[0_0_28px_rgba(139,92,246,0.22)]';

  const labelClass = isMain ? 'text-emerald-300' : 'text-violet-300';
  const iconShellClass = isMain
    ? 'border-emerald-400/25 bg-emerald-500/15 text-emerald-300'
    : 'border-violet-400/25 bg-violet-500/15 text-violet-300';

  const Icon = isMain ? Trophy : Gamepad2;

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border px-3 py-2 ${shellClass}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${iconShellClass}`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        <p
          className={`text-[8px] font-bold uppercase tracking-[0.16em] ${labelClass}`}
        >
          {label}
        </p>
      </div>

      <p className="mt-1.5 text-xl font-bold leading-none tracking-tight text-white">
        {amount}
        <span className="ml-1 text-xs font-semibold text-slate-300">ETB</span>
      </p>
    </article>
  );
}

export default function WalletBalanceSection({
  mainWallet,
  playWallet,
  totalAvailable,
  loading,
  onDeposit,
}) {
  const mainDisplay = loading ? '…' : mainWallet;
  const playDisplay = loading ? '…' : playWallet;
  const totalDisplay = loading ? '…' : totalAvailable;

  return (
    <section className="shrink-0 space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <BalanceCard label="MAIN WALLET" amount={mainDisplay} tone="main" />
        <BalanceCard label="PLAY WALLET" amount={playDisplay} tone="play" />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-[#12151f] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          TOTAL AVAILABLE
        </p>
        <p className="text-lg font-bold tabular-nums tracking-tight text-cyan-300 drop-shadow-[0_0_14px_rgba(103,232,249,0.45)]">
          {totalDisplay}
          <span className="ml-1 text-sm font-semibold text-slate-200">ETB</span>
        </p>
      </div>

      {typeof onDeposit === 'function' ? (
        <button
          type="button"
          onClick={onDeposit}
          className="w-full rounded-2xl border border-emerald-400/25 bg-emerald-500/15 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200"
        >
          Deposit
        </button>
      ) : null}
    </section>
  );
}
