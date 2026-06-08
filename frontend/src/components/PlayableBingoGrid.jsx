import { Star } from 'lucide-react';
import { generateBingoCard } from '../utils/bingoCard';

const COLUMN_HEADERS = [
  { letter: 'B', pill: 'bg-blue-500' },
  { letter: 'I', pill: 'bg-indigo-600' },
  { letter: 'N', pill: 'bg-fuchsia-500' },
  { letter: 'G', pill: 'bg-teal-500' },
  { letter: 'O', pill: 'bg-orange-500' },
];

/** Compact fixed grid — 1 cartel, centered like reference photo */
const SINGLE_HEADER =
  'flex h-6 w-[28px] shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold leading-none text-white shadow-sm';
const SINGLE_BODY =
  'flex h-7 w-[28px] shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold leading-none tabular-nums';

/** Main game — fluid cells: readable on phones, full size on larger screens */
const GAME_SINGLE_HEADER =
  'flex h-[clamp(22px,6vw,32px)] w-[clamp(22px,6.5vw,40px)] shrink-0 items-center justify-center rounded-full text-[clamp(8px,2.4vw,11px)] font-extrabold leading-none text-white shadow-sm';
const GAME_SINGLE_BODY =
  'flex h-[clamp(26px,7vw,36px)] w-[clamp(22px,6.5vw,40px)] shrink-0 items-center justify-center rounded-sm border text-[clamp(10px,2.8vw,13px)] font-bold leading-none tabular-nums touch-manipulation';

/** Main game — dual cartelas: fixed proportional cells, never squeezed */
const GAME_DUAL_HEADER =
  'flex h-[clamp(20px,5.5vw,28px)] w-[clamp(20px,6vw,36px)] shrink-0 items-center justify-center rounded-full text-[clamp(8px,2.2vw,10px)] font-extrabold leading-none text-white shadow-sm';
const GAME_DUAL_BODY =
  'flex h-[clamp(24px,6.5vw,32px)] w-[clamp(20px,6vw,36px)] shrink-0 items-center justify-center rounded-sm border text-[clamp(9px,2.5vw,12px)] font-bold leading-none tabular-nums touch-manipulation';

export default function PlayableBingoGrid({
  cartelId,
  grid: serverGrid,
  calledNumbers,
  automatic,
  manualMarks,
  onToggleMark,
  variant = 'default',
  layout = 'dual',
  hideLabel = false,
  ownerLabel,
  labelPosition = 'bottom',
}) {
  const { grid: localGrid } = generateBingoCard(cartelId);
  const grid = serverGrid ?? localGrid;
  const called =
    calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers);

  const isGame = variant === 'game';
  const isSingle = layout === 'single';
  const isGameDual = isGame && layout === 'dual';
  const useFixedCells = isSingle || isGameDual;
  const cellText = useFixedCells
    ? ''
    : isGame
      ? 'text-[clamp(11px,2.6vh,15px)]'
      : 'text-[clamp(8px,1.8vh,10px)]';
  const headerText = useFixedCells
    ? ''
    : isGame
      ? 'text-[clamp(10px,2.3vh,13px)]'
      : 'text-[clamp(7px,1.6vh,9px)]';

  const fixedHeaderClass = isGameDual
    ? GAME_DUAL_HEADER
    : isGame
      ? GAME_SINGLE_HEADER
      : SINGLE_HEADER;
  const fixedBodyClass = isGameDual
    ? GAME_DUAL_BODY
    : isGame
      ? GAME_SINGLE_BODY
      : SINGLE_BODY;

  const isMarked = (row, col, cell) => {
    if (row === 2 && col === 2) return true;
    if (automatic && cell != null && called.has(cell)) return true;
    return manualMarks?.has(`${row}-${col}`) ?? false;
  };

  const renderCell = (rowIndex, colIndex, cell, fixedSingle) => {
    const isFree = rowIndex === 2 && colIndex === 2;
    const marked = isMarked(rowIndex, colIndex, cell);
    const canTap = !automatic && onToggleMark && !isFree;
    const base = fixedSingle
      ? fixedBodyClass
      : `flex aspect-square min-h-0 w-full max-w-full items-center justify-center justify-self-center rounded-sm border font-bold tabular-nums leading-none ${cellText}`;

    return (
      <button
        key={`${rowIndex}-${colIndex}`}
        type="button"
        disabled={!canTap}
        onClick={() => canTap && onToggleMark(rowIndex, colIndex)}
        className={`${base} ${
          isFree
            ? 'border-emerald-600 bg-emerald-500'
            : marked
              ? 'border-green-400 bg-green-500 text-white'
              : 'border-gray-400/70 bg-white text-gray-900'
        } ${canTap ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
      >
        {isFree ? (
          <Star
            className={
              fixedSingle
                ? isGame
                  ? 'h-4 w-4 shrink-0 fill-white text-white'
                  : 'h-3.5 w-3.5 shrink-0 fill-white text-white'
                : 'h-[55%] w-[55%] shrink-0 fill-white text-white'
            }
            aria-label="Free space"
          />
        ) : (
          cell
        )}
      </button>
    );
  };

  const renderMatrix = (fixedSingle = false) => (
    <div
      className={
        fixedSingle
          ? `inline-grid max-w-full shrink-0 grid-cols-5 bg-[#0A0F1D] ${isGameDual ? 'gap-[clamp(2px,0.8vw,3px)]' : 'gap-[clamp(2px,1vw,4px)]'}`
          : `grid h-full w-full grid-cols-5 bg-[#0A0F1D] ${isGame ? 'gap-[3px]' : 'gap-[2px]'}`
      }
      style={
        fixedSingle ? undefined : { gridTemplateRows: 'repeat(6, minmax(0, 1fr))' }
      }
    >
      {COLUMN_HEADERS.map(({ letter, pill }) => (
        <div
          key={letter}
          className={
            fixedSingle
              ? `${fixedHeaderClass} ${pill}`
              : `flex min-h-0 min-w-0 items-center justify-center rounded-full font-extrabold leading-none text-white ${pill} ${headerText}`
          }
        >
          {letter}
        </div>
      ))}

      {grid.map((row, rowIndex) =>
        row.map((cell, colIndex) => renderCell(rowIndex, colIndex, cell, fixedSingle))
      )}
    </div>
  );

  if (!isGame) {
    return (
      <article className="inline-flex w-[120px] max-w-[120px] shrink-0 flex-col items-center gap-1">
        <span className="shrink-0 rounded-full bg-orange-500 px-2.5 py-0.5 text-[8px] font-extrabold text-white">
          CARTEL #{cartelId}
        </span>
        <div className="w-full shrink-0">{renderMatrix(true)}</div>
      </article>
    );
  }

  const caption = ownerLabel ?? `CARTEL #${cartelId}`;
  const captionEl = !hideLabel ? (
    <p
      className={`max-w-full shrink-0 truncate rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-center text-[10px] font-extrabold uppercase tracking-wider text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${
        labelPosition === 'top' ? 'mb-2' : 'mt-2'
      }`}
    >
      {caption}
    </p>
  ) : null;

  if (isSingle) {
    return (
      <article className="flex w-full max-w-full shrink-0 flex-col items-center">
        {labelPosition === 'top' ? captionEl : null}
        <div className="max-w-full overflow-x-auto overflow-y-visible">
          {renderMatrix(true)}
        </div>
        {labelPosition !== 'top' ? captionEl : null}
      </article>
    );
  }

  return (
    <article className="flex w-full max-w-full shrink-0 flex-col items-center">
      {labelPosition === 'top' ? captionEl : null}
      {isGameDual ? (
        <div className="max-w-full overflow-x-auto overflow-y-visible">
          {renderMatrix(true)}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div
            className="h-full max-h-full w-full max-w-full"
            style={{ aspectRatio: '5 / 6' }}
          >
            {renderMatrix(false)}
          </div>
        </div>
      )}
      {labelPosition !== 'top' ? captionEl : null}
    </article>
  );
}
