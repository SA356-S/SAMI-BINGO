export default function NumberBoard({
  numbers,
  newestNumber = null,
  limit = 20,
}: {
  numbers: number[];
  newestNumber?: number | null;
  limit?: number;
}) {
  const last = numbers.slice(-limit);

  return (
    <div className="rounded-xl border border-panel-border bg-panel-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Last {limit} numbers
        </p>
        {newestNumber != null ? (
          <p className="text-xs font-bold text-indigo-400">
            Newest: {newestNumber}
          </p>
        ) : (
          <p className="text-xs font-bold text-slate-500">Newest: —</p>
        )}
      </div>

      <div className="grid grid-cols-5 gap-2">
        {last.length === 0 ? (
          <p className="col-span-5 text-center text-sm text-slate-500">
            No numbers yet.
          </p>
        ) : (
          last.map((n, idx) => {
            const isNewest = newestNumber != null && n === newestNumber;
            return (
              <div
                key={`${n}-${idx}`}
                className={[
                  'flex aspect-square items-center justify-center rounded-lg border text-lg font-extrabold tabular-nums',
                  isNewest
                    ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-200 shadow-[0_0_18px_rgba(99,102,241,0.35)]'
                    : 'border-white/10 bg-[#0f172a] text-slate-200',
                ].join(' ')}
              >
                {n}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

