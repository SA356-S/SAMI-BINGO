import { useState } from 'react';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Clock,
  Gamepad2,
  Trophy,
  X,
} from 'lucide-react';
import FourCornersGridIcon from '../components/FourCornersGridIcon';

const TABS = [
  { id: 'intro', label: 'መግቢያ', customIcon: true },
  { id: 'game', label: 'ጨዋታ', icon: Gamepad2 },
  { id: 'winner', label: 'አሸናፊ', icon: Trophy },
  { id: 'penalty', label: 'ቅጣት', icon: Ban },
];

function TabIcon({ tab, active }) {
  if (tab.customIcon) {
    return <FourCornersGridIcon active={active} className="h-5 w-5 shrink-0" />;
  }

  const Icon = tab.icon;
  return (
    <Icon
      className={`h-5 w-5 shrink-0 ${
        active
          ? tab.id === 'penalty'
            ? 'text-red-400'
            : tab.id === 'winner'
              ? 'text-amber-400'
              : 'text-blue-400'
          : 'text-white/40'
      }`}
      strokeWidth={active ? 2.25 : 1.75}
    />
  );
}

function StepItem({ number, title, description }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white shadow-[0_0_12px_rgba(59,130,246,0.5)]">
        {number}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-white">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function IntroView() {
  return (
    <div className="space-y-3">
      <StepItem
        number={1}
        title="ካርድ ማስመረጥ"
        description="ከቀርበው ዝርዝር ውስጥ የሚወዱትን ቢንጎ ካርድ ይምረጡ። ካርድዎ ብቻዎ ነው።"
      />
      <StepItem
        number={2}
        title="ቁጥር ምልክት"
        description="የተጠሩ ቁጥሮች በካርድዎ ላይ ካሉ በኋላ ወዲያውኑ ይምረጧቸው።"
      />
      <StepItem
        number={3}
        title="ቅድመ እይታ"
        description="ጨዋታ ከመጀመሩ በፊት ካርድዎን እና የገንዘብ ቀሪ ሂሳብዎን ያረጋግጡ።"
      />
      <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
          <Clock className="h-5 w-5" />
        </span>
        <p className="text-xs leading-relaxed text-white/70">
          <span className="font-semibold text-blue-300">ሰዓት ቆጣሪ:</span> እያንዳንዱ
          ቁጥር ከተጠራ በኋላ ለመምረጥ የተወሰነ ጊዜ አለ። ጊዜ ካለፈ በኋላ ቁጥሩ አይመረጥም።
        </p>
      </div>
    </div>
  );
}

function GameView() {
  return (
    <div className="space-y-3">
      <StepItem
        number={1}
        title="መግባት"
        description="የተመረጠውን ዋጋ (Stake) ከዋሌትዎ በመቀነስ ወደ ጨዋታ ይግቡ።"
      />
      <StepItem
        number={2}
        title="የቀጣዩ ጥሪ"
        description="ሰርቨሩ ቁጥር እያጠራ ይሄዳል። የተጠራው ቁጥር በሁሉም ተጫዋቾች ላይ በአንድ ጊዜ ይታያል።"
      />
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
        <p className="text-xs font-bold tracking-wide text-emerald-400">
          MARKING / መምረጥ
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/60">
          በካርድዎ ላይ ያለው ቁጥር ከተጠራ ቁጥሮች ውስጥ ካለ ወዲያውኑ መታ ያድርጉ። ምልክቱ በቀጥታ ይታያል።
        </p>
      </div>
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
        <p className="text-xs font-bold tracking-wide text-amber-400">
          UNMARKING / ማጥፋት
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/60">
          በስህተት ከመረጡ ቁጥር ላይ እንደገና መታ በማድረግ ምልክቱን ማስወገድ ይቻላል — ከጊዜው በፊት ብቻ።
        </p>
      </div>
    </div>
  );
}

const WIN_PATTERN_GRIDS = {
  horizontal: ['█████', '░░░░░', '░░░░░', '░░░░░', '░░░░░'],
  vertical: ['█░░░░', '█░░░░', '█░░░░', '█░░░░', '█░░░░'],
  diagonal: ['█░░░░', '░█░░░', '░░█░░', '░░░█░', '░░░░█'],
  corners: ['█░░░█', '░░░░░', '░░░░░', '░░░░░', '█░░░█'],
};

function PatternGrid({ type }) {
  const rows = WIN_PATTERN_GRIDS[type] || WIN_PATTERN_GRIDS.horizontal;

  return (
    <div className="mx-auto grid grid-cols-5 gap-0.5 p-1">
      {rows.map((row, ri) =>
        row.split('').map((cell, ci) => (
          <span
            key={`${ri}-${ci}`}
            className={`h-2.5 w-2.5 rounded-[1px] ${
              cell === '█'
                ? 'bg-amber-400 shadow-[0_0_3px_rgba(251,191,36,0.6)]'
                : 'bg-white/10'
            }`}
          />
        ))
      )}
    </div>
  );
}

function DiagonalArrowIcon({ active }) {
  return (
    <span
      className={`flex items-center justify-center gap-0 ${
        active ? 'text-amber-400' : 'text-white/45'
      }`}
    >
      <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
      <ArrowDownLeft className="h-3.5 w-3.5 -ml-1.5" strokeWidth={2.5} />
    </span>
  );
}

function FourCornersMarkerIcon({ active }) {
  return (
    <span
      className={`relative flex h-5 w-5 items-center justify-center text-[9px] leading-none ${
        active ? 'text-amber-400' : 'text-white/45'
      }`}
    >
      <span className="absolute left-0 top-0">⌜</span>
      <span className="absolute right-0 top-0">⌝</span>
      <span className="absolute bottom-0 left-0">⌞</span>
      <span className="absolute bottom-0 right-0">⌟</span>
    </span>
  );
}

const WIN_PATTERNS = [
  { id: 'horizontal', label: 'ወደጎን', arrow: 'horizontal' },
  { id: 'vertical', label: 'ወደታች', arrow: 'vertical' },
  { id: 'diagonal', label: 'እግዳሚ', arrow: 'diagonal' },
  { id: 'corners', label: 'አራቱን ማእዘናት', arrow: 'corners' },
];

function PatternArrowIcon({ type, active }) {
  const color = active ? 'text-amber-400' : 'text-white/45';
  if (type === 'horizontal') {
    return <ArrowRight className={`h-4 w-4 ${color}`} strokeWidth={2.5} />;
  }
  if (type === 'vertical') {
    return <ArrowDown className={`h-4 w-4 ${color}`} strokeWidth={2.5} />;
  }
  if (type === 'diagonal') {
    return <DiagonalArrowIcon active={active} />;
  }
  return <FourCornersMarkerIcon active={active} />;
}

function WinnerView() {
  const [selectedPattern, setSelectedPattern] = useState('horizontal');

  return (
    <div className="space-y-3">
      {/* Trophy header — unchanged from first reference */}
      <div className="text-center">
        <Trophy className="mx-auto h-10 w-10 text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.5)]" />
        <h3 className="mt-3 text-lg font-bold text-amber-300">BINGO አሸናፊ</h3>
      </div>

      {/* Orange rules box — second reference */}
      <div className="rounded-2xl border border-orange-500/35 bg-gradient-to-b from-orange-600/25 via-amber-600/15 to-transparent px-4 py-4">
        <h4 className="text-sm font-bold text-white">
          አሸናፊ ለመሆን{' '}
          <span className="font-medium text-white/55">(To Be A Winner)</span>
        </h4>
        <p className="mt-3 text-xs leading-relaxed text-white/85">
          ቁጥሮቹ ሲጠሩ ከመጫወቻ ካርዳችን ላይ እየመረጥን ወደጎን ወይም ወደታች ወይም
          ወደሁለቱም እግዳሚ ወይም አራቱን ማእዘናት ከመረጥን ወደዋናው ከታች በኩል{' '}
          <span className="font-bold text-amber-200">BINGO</span> የሚለውን
          በመንካት ማሸነፍ እንችላለን።
        </p>
      </div>

      {/* Pattern selector — 2×2 grid */}
      <div className="grid grid-cols-2 gap-2">
        {WIN_PATTERNS.map(({ id, label, arrow }) => {
          const active = selectedPattern === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedPattern(id)}
              className={`flex flex-col items-center rounded-xl border px-2 py-2.5 transition ${
                active
                  ? 'border-amber-500/45 bg-amber-500/15 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                  : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.06]'
              }`}
            >
              <PatternArrowIcon type={arrow} active={active} />
              <PatternGrid type={id} />
              <p
                className={`mt-1.5 text-[10px] font-semibold ${
                  active ? 'text-amber-300' : 'text-white/55'
                }`}
              >
                {label}
              </p>
            </button>
          );
        })}
      </div>

      {/* Footer disclaimer */}
      <p className="px-2 pb-1 text-center text-[10px] leading-relaxed text-white/40">
        ሁለት ወይም ከዚያ በላይ ተጫዋቾች እኩል ሲያሸንፉ የራሱ በ እኩል ይከፈላል።
      </p>
    </div>
  );
}

function PenaltyView() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-center">
        <Ban className="mx-auto h-8 w-8 text-red-400" />
        <h3 className="mt-2 text-sm font-bold text-red-300">
          ያልፈለጉ ቢንጎ (ቅጣት)
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-white/55">
          ትክክለኛ አሸናፊ ያልሆኑ ቢንጎ ጥያቄዎች ቅጣት ይያዛቸዋል።
        </p>
      </div>
      {[
        {
          title: 'ከጨዋታው ወዲያውኑ መሰረዝ',
          body: 'የውድቅ ቢንጎ ካገኙ ተጫዋቹ ወዲያውኑ ከዚያ ጨዋታ ውጭ ይወጣል።',
        },
        {
          title: 'ያሸነፉት ገንዘብ (Stake) አይመለስም',
          body: 'በውድቅ ቢንጎ ላይ የተጠቀሰው ዋጋ ወይም ቁጠባ አይመለስም።',
        },
      ].map(({ title, body }) => (
        <div
          key={title}
          className="flex gap-3 rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-3"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/50 bg-red-500/20 text-red-400">
            <X className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <div>
            <p className="text-sm font-semibold text-red-300">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-white/50">{body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const TAB_CONTENT = {
  intro: IntroView,
  game: GameView,
  winner: WinnerView,
  penalty: PenaltyView,
};

export default function Rules({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('intro');
  const Content = TAB_CONTENT[activeTab];

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-theme-navy font-sans text-white">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white"
          aria-label="Back to Home"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 truncate text-base font-bold text-white sm:text-lg">ቢንጎ ህጎች</h1>
      </header>

      {/* Tab navigation */}
      <nav className="horizontal-scroll-touch shrink-0 flex gap-1 overflow-x-auto px-2 py-2 sm:px-3">
        {TABS.map((tab) => {
          const { id, label } = tab;
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex min-h-[44px] min-w-[4rem] flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 transition sm:min-w-[4.5rem] sm:px-2 ${
                active
                  ? 'border border-blue-500/40 bg-blue-500/20 shadow-[0_0_16px_rgba(59,130,246,0.35)]'
                  : 'border border-transparent bg-white/[0.03] text-white/45 hover:bg-white/[0.06]'
              }`}
            >
              <TabIcon tab={tab} active={active} />
              <span
                className={`text-[10px] font-semibold ${
                  active ? 'text-white' : 'text-white/45'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-6">
        <Content />
      </main>
    </div>
  );
}
