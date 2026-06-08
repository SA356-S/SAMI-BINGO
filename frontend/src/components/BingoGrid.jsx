import { Star } from 'lucide-react';
import { generateBingoCard } from '../utils/bingoCard';

/** B-I-N-G-O pill headers — match reference 1000012776 */
const COLUMN_HEADERS = [
  { letter: 'B', pill: 'bg-blue-500' },
  { letter: 'I', pill: 'bg-indigo-600' },
  { letter: 'N', pill: 'bg-fuchsia-500' },
  { letter: 'G', pill: 'bg-teal-500' },
  { letter: 'O', pill: 'bg-orange-500' },
];

/** Fluid card footprint — scales on phones, full size on larger screens */
const CARD_SHELL =
  'mx-auto inline-flex w-full max-w-[min(100%,158px)] shrink-0 flex-col items-center gap-1.5 overflow-visible sm:gap-2';

const BADGE =
  'shrink-0 translate-x-2 rounded-full bg-orange-500 px-3.5 py-1 text-[10px] font-extrabold tracking-wide text-white shadow-[0_2px_12px_rgba(249,115,22,0.6)] sm:translate-x-2.5 sm:px-4 sm:py-1 sm:text-[11px]';

const MATRIX_WRAP =
  'w-full max-w-full shrink-0 overflow-visible rounded-lg bg-transparent';

const MATRIX_GRID =
  'inline-grid max-w-full shrink-0 grid-cols-5 gap-[clamp(2px,0.8vw,3px)] bg-[#0A0F1D] p-0';

const HEADER_CELL =
  'flex h-[clamp(22px,6vw,24px)] w-[clamp(22px,6.5vw,28px)] shrink-0 items-center justify-center rounded-none text-[clamp(8px,2.4vw,9px)] font-extrabold leading-none text-white shadow-sm';

const BODY_CELL =
  'flex h-[clamp(26px,7vw,28px)] w-[clamp(22px,6.5vw,28px)] shrink-0 items-center justify-center rounded-sm border border-gray-400/70 bg-white text-[clamp(9px,2.6vw,10px)] font-bold leading-none tabular-nums text-gray-900';

export default function BingoGrid({ cartelId }) {
  const { grid } = generateBingoCard(cartelId);

  return (
    <article className={CARD_SHELL}>
      <span className={BADGE}>CARTEL #{cartelId}</span>

      <div className={MATRIX_WRAP}>
        <div className={MATRIX_GRID}>
          {COLUMN_HEADERS.map(({ letter, pill }) => (
            <div key={letter} className={`${HEADER_CELL} ${pill}`}>
              {letter}
            </div>
          ))}

          {grid.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const isFree = rowIndex === 2 && colIndex === 2;
              return (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={
                    isFree
                      ? 'flex h-[clamp(26px,7vw,28px)] w-[clamp(22px,6.5vw,28px)] shrink-0 items-center justify-center rounded-sm border border-emerald-600 bg-emerald-500'
                      : BODY_CELL
                  }
                >
                  {isFree ? (
                    <Star
                      className="h-[clamp(12px,3.5vw,14px)] w-[clamp(12px,3.5vw,14px)] shrink-0 fill-white text-white drop-shadow-sm"
                      aria-label="Free space"
                    />
                  ) : (
                    cell
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </article>
  );
}
