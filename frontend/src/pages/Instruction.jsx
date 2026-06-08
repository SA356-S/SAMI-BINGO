import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { initTelegramWebApp, isTelegramWebApp } from '../api/playerIdentity';

const INSTRUCTION_TITLE = 'የቢንጎ ጨዋታ ህጎች';

const INSTRUCTION_SECTIONS = [
  {
    id: 'card',
    icon: '🃏',
    title: 'መጫወቻ ካርድ',
    items: [
      'ጨዋታውን ለመጀመር ከሚመጣልን ከ1-400 የመጫወቻ ካርድ ውስጥ አንዱን እንመርጣለን::',
      'የመጫወቻ ካርዱ ላይ በቀይ ቀለም የተመረጡ ቁጥሮች የሚያሳዩት መጫወቻ ካርድ በሌላ ተጫዋች መመረጡን ነው::',
      'የመጫወቻ ካርድ ስንነካው ከታች በኩል ካርድ ቁጥሩ የሚይዘውን መጫወቻ ካርድ ያሳየናል::',
      'ወደ ጨዋታው ለመግባት የምንፈልገውን ካርድ ከመረጥን ለምዝገባ የተሰጠው ሰከንድ ዜሮ ሲሆን ቀጥታ ወደ ጨዋታ ያስገባናል::',
    ],
  },
  {
    id: 'game',
    icon: '🎮',
    title: 'ጨዋታ',
    items: [
      'ወደ ጨዋታው ስንገባ በመረጥነው የካርድ ቁጥር መሰረት የመጫወቻ ካርድ እናገኛለን::',
      'ጨዋታው ሲጀመር የተለያዩ ቁጥሮች ከ1 እስከ 75 መጥራት ይጀምራል::',
      'የሚጠራው ቁጥር የኛ መጫወቻ ካርድ ውስጥ ካለ የተጠራውን ቁጥር ክሊክ በማረግ መምረጥ እንችላለን::',
      'የመረጥነውን ቁጥር ማጥፋት ከፈለግን መልሰን እራሱን ቁጥር ክሊክ በማረግ ማጥፋት እንችላለን::',
    ],
  },
  {
    id: 'winner',
    icon: '🏆',
    title: 'አሸናፊ',
    items: [
      'ቁጥሮቹ ሲጠሩ ከመጫወቻ ካርዳችን ላይ እየመረጥን ወደጎን ወይም ወደታች ወይም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት ከመረጥን ወዲያውኑ ከታች በኩል bingo የሚለውን በመንካት ማሸነፍ እንችላለን::',
      'ወደጎን ወይም ወደታች ወይም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት ሳይጠሩ bingo የሚለውን ክሊክ ብናደርግ ጌሙ እንዳልሸነፍን ይነግረናል::',
      'ሁለት ወይም ከዚያ በላይ ተጫዋቾች እኩል ቢያሸንፉ ድርሻው ለቁጥራቸው ይከፈላል::',
    ],
  },
];

function InstructionSection({ icon, title, items }) {
  return (
    <article className="relative overflow-hidden rounded-[14px] border border-[#3d3428]/80 bg-[#2a2418] pl-0 shadow-[0_4px_18px_rgba(0,0,0,0.35)]">
      <span
        className="absolute bottom-0 left-0 top-0 w-1 bg-[#d4a017]"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute right-3 top-2 text-2xl leading-none text-[#d4a017]/70"
        aria-hidden="true"
      >
        ”
      </span>

      <div className="px-4 py-4 pl-5 sm:px-5 sm:py-5">
        <header className="mb-3 flex items-center gap-2">
          <span className="text-xl leading-none" aria-hidden="true">
            {icon}
          </span>
          <h2 className="text-lg font-bold text-white sm:text-xl">{title}</h2>
        </header>

        <ol className="space-y-3">
          {items.map((text, index) => (
            <li
              key={index}
              className="flex gap-2 text-sm leading-relaxed text-[#e8dcc8] sm:text-[15px]"
            >
              <span className="shrink-0 font-semibold text-[#f0e6d2]">
                {index + 1}.
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function handleClose() {
  const tg = window.Telegram?.WebApp;
  if (isTelegramWebApp() && typeof tg?.close === 'function') {
    tg.close();
    return;
  }
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = '/';
}

export default function Instruction() {
  useEffect(() => {
    initTelegramWebApp();
  }, []);

  return (
    <div className="flex min-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0a0a0f] font-sans text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <button
          type="button"
          onClick={handleClose}
          className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white"
          aria-label="Close instructions"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 text-base font-bold text-white sm:text-lg">
          {INSTRUCTION_TITLE}
        </h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-5">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 sm:gap-4">
          {INSTRUCTION_SECTIONS.map((section) => (
            <InstructionSection key={section.id} {...section} />
          ))}
        </div>
      </main>
    </div>
  );
}
