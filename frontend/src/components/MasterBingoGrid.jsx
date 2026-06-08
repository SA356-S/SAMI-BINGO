import { BINGO_COLUMNS } from '../utils/bingoCard';

/** Reference screenshot — square B-I-N-G-O headers */
const HEADER_COLORS = [
  'bg-[#42a5f5]',
  'bg-[#7e57c2]',
  'bg-[#ec407a]',
  'bg-[#66bb6a]',
  'bg-[#ffa726]',
];

const ROWS = 15;

const CELL_BASE =
  'flex min-h-0 w-full min-w-0 items-center justify-center rounded-lg font-extrabold leading-none tabular-nums transition-[background-color,box-shadow] duration-200 text-[11px] sm:text-[12px]';

const CELL_IDLE =
  'bg-[#3a4060] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]';

const CELL_CALLED =
  'bg-[#ff8a3d] text-white shadow-[0_0_8px_rgba(255,138,61,0.35)]';

const CELL_LATEST =
  'bg-[#22c55e] text-white shadow-[0_0_10px_rgba(34,197,94,0.4)]';

export default function MasterBingoGrid({ calledNumbers, latestBall = null }) {
  const called =
    calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <div className="mb-1.5 grid shrink-0 grid-cols-5 gap-1.5 sm:gap-2">
        {BINGO_COLUMNS.map(({ letter }, i) => (
          <div
            key={letter}
            className={`flex aspect-[10/11] w-full min-w-0 items-center justify-center rounded-lg text-[11px] font-extrabold tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] sm:text-xs ${HEADER_COLORS[i]}`}
          >
            {letter}
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-5 gap-1.5 overflow-hidden sm:gap-2"
        style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: ROWS }, (_, rowIndex) =>
          BINGO_COLUMNS.map(({ min, letter }) => {
            const num = min + rowIndex;
            const isCalled = called.has(num);
            const isLatest = latestBall != null && num === latestBall;

            let cellClass = CELL_IDLE;
            if (isLatest) {
              cellClass = CELL_LATEST;
            } else if (isCalled) {
              cellClass = CELL_CALLED;
            }

            return (
              <div
                key={`${letter}-${num}`}
                className={`${CELL_BASE} ${cellClass}`}
              >
                {num}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
