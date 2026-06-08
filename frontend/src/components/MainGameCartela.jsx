import { Star } from 'lucide-react';

import { generateBingoCard } from '../utils/bingoCard';



/** B-I-N-G-O column colors — reference screenshot */

const COLUMN_HEADERS = [

  { letter: 'B', color: 'bg-[#42a5f5]' },

  { letter: 'I', color: 'bg-[#7e57c2]' },

  { letter: 'N', color: 'bg-[#ec407a]' },

  { letter: 'G', color: 'bg-[#66bb6a]' },

  { letter: 'O', color: 'bg-[#ffa726]' },

];



/**

 * Main Game cartela — full-width, height-filling reference layout.

 * Marking / tap behavior unchanged from prior implementation.

 */

export default function MainGameCartela({

  cartelId,

  grid: serverGrid,

  calledNumbers,

  automatic,

  manualMarks,

  onToggleMark,

  stacked = false,

}) {

  const { grid: localGrid } = generateBingoCard(cartelId);

  const grid = serverGrid ?? localGrid;

  const called =

    calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers);



  const isMarked = (row, col, cell) => {

    if (row === 2 && col === 2) return true;

    if (automatic && cell != null && called.has(cell)) return true;

    return manualMarks?.has(`${row}-${col}`) ?? false;

  };



  const renderCell = (rowIndex, colIndex, cell) => {

    const isFree = rowIndex === 2 && colIndex === 2;

    const marked = isMarked(rowIndex, colIndex, cell);

    const canTap = !automatic && onToggleMark && !isFree;



    return (

      <button

        key={`${rowIndex}-${colIndex}`}

        type="button"

        disabled={!canTap}

        onClick={() => canTap && onToggleMark(rowIndex, colIndex)}

        className={`flex h-full min-h-0 w-full min-w-0 touch-manipulation items-center justify-center rounded-[5px] font-extrabold leading-none tabular-nums ${

          stacked

            ? 'text-[clamp(10px,2.6vw,13px)]'

            : 'text-[clamp(11px,3vw,15px)]'

        } ${

          isFree

            ? 'bg-[#22c55e] text-white'

            : marked

              ? 'bg-[#22c55e] text-white'

              : 'bg-white text-[#0f172a]'

        } ${canTap ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'}`}

      >

        {isFree ? (

          <Star

            className={`shrink-0 fill-white text-white ${

              stacked ? 'h-[clamp(11px,2.8vw,15px)] w-[clamp(11px,2.8vw,15px)]' : 'h-[clamp(13px,3.2vw,17px)] w-[clamp(13px,3.2vw,17px)]'

            }`}

            aria-label="Free space"

          />

        ) : (

          cell

        )}

      </button>

    );

  };



  const headerClass = stacked

    ? 'text-[clamp(10px,2.4vw,12px)]'

    : 'text-[clamp(11px,2.8vw,13px)]';



  return (

    <article className="flex h-full min-h-0 max-h-full w-full flex-col">

      <div className="flex min-h-0 w-full flex-1 flex-col rounded-xl bg-[#0a0f1d]/80 p-[3px]">

        <div

          className="grid h-full min-h-0 w-full flex-1 grid-cols-5 gap-[3px]"

          style={{

            gridTemplateRows: stacked

              ? 'minmax(20px, 0.85fr) repeat(5, minmax(0, 1fr))'

              : 'minmax(24px, 0.9fr) repeat(5, minmax(0, 1fr))',

          }}

        >

          {COLUMN_HEADERS.map(({ letter, color }) => (

            <div

              key={letter}

              className={`flex min-h-0 w-full items-center justify-center rounded-[5px] font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] ${headerClass} ${color}`}

            >

              {letter}

            </div>

          ))}



          {grid.map((row, rowIndex) =>

            row.map((cell, colIndex) => renderCell(rowIndex, colIndex, cell))

          )}

        </div>

      </div>



      <p

        className={`shrink-0 text-center font-bold uppercase tracking-[0.14em] text-white ${

          stacked ? 'pt-0.5 text-[8px]' : 'pt-1 text-[9px]'

        }`}

      >

        CARTELA # {cartelId}

      </p>

    </article>

  );

}


