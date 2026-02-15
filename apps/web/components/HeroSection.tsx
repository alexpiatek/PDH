type Suit = 'S' | 'H' | 'D' | 'C';

type PokerCard = {
  id: string;
  rank: string;
  suit: Suit;
};

type CardProps = {
  card: PokerCard;
  compact?: boolean;
};

const HERO_HAND: PokerCard[] = [
  { id: 'AS', rank: 'A', suit: 'S' },
  { id: 'KS', rank: 'K', suit: 'S' },
  { id: 'QS', rank: 'Q', suit: 'S' },
  { id: '2H', rank: '2', suit: 'H' },
  { id: '2C', rank: '2', suit: 'C' },
];

const FLOP: PokerCard[] = [
  { id: '10S', rank: '10', suit: 'S' },
  { id: '5D', rank: '5', suit: 'D' },
  { id: '9C', rank: '9', suit: 'C' },
];

const RULES = [
  '2-9 players, standard 52-card deck.',
  'Every player starts with 5 private cards.',
  'After flop, turn, and river, each player discards exactly 1 card.',
  'Showdown uses exactly 2 hole cards and 5 community cards.',
  'Discards stay hidden for the full hand.',
] as const;

const SUIT_SYMBOL: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const SUIT_COLOR: Record<Suit, string> = {
  S: 'text-slate-900',
  C: 'text-slate-900',
  H: 'text-rose-600',
  D: 'text-rose-600',
};

function Card({ card, compact = false }: CardProps) {
  const suitSymbol = SUIT_SYMBOL[card.suit];
  const suitColor = SUIT_COLOR[card.suit];

  return (
    <div
      className={[
        'relative rounded-2xl border border-slate-300/90 bg-white text-slate-900 shadow-[0_14px_38px_rgba(15,23,42,0.28)]',
        compact
          ? 'h-[5.8rem] w-[4.15rem] sm:h-[6.5rem] sm:w-[4.6rem]'
          : 'h-[7.2rem] w-[5rem] sm:h-[8.2rem] sm:w-[5.7rem]',
      ].join(' ')}
    >
      <div
        className={[
          'absolute left-2 top-1.5 text-[1rem] leading-none font-extrabold',
          suitColor,
        ].join(' ')}
      >
        <div>{card.rank}</div>
        <div className="text-[0.85rem]">{suitSymbol}</div>
      </div>

      <div
        className={[
          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-black leading-none',
          compact ? 'text-3xl' : 'text-4xl',
          suitColor,
        ].join(' ')}
      >
        {suitSymbol}
      </div>

      <div
        className={[
          'absolute bottom-1.5 right-2 rotate-180 text-[1rem] leading-none font-extrabold',
          suitColor,
        ].join(' ')}
      >
        <div>{card.rank}</div>
        <div className="text-[0.85rem]">{suitSymbol}</div>
      </div>
    </div>
  );
}

export default function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-36 right-[-8rem] h-[24rem] w-[24rem] rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-44 left-[-7rem] h-[22rem] w-[22rem] rounded-full bg-purple-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(34,211,238,0.17),transparent_34%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.15),transparent_40%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-6">
            <p className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Bondi Poker | Discard Hold&apos;em
            </p>

            <h1 className="max-w-2xl text-4xl font-black leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Play poker with faster decisions and bigger swings.
            </h1>

            <p className="max-w-2xl text-base text-slate-300 sm:text-lg">
              Start with 5 cards. Discard 1 after flop, turn, and river. Reach showdown with 2
              hole cards.
            </p>

            <div className="flex flex-wrap gap-3">
              <a
                href="/play"
                className="inline-flex items-center justify-center rounded-xl border border-cyan-300/60 bg-cyan-400/25 px-6 py-3 text-sm font-bold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.45)] transition hover:shadow-[0_0_34px_rgba(34,211,238,0.65)]"
              >
                Play Now
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-xl border border-purple-400/45 bg-purple-500/10 px-6 py-3 text-sm font-semibold text-purple-100 transition hover:bg-purple-500/20"
              >
                How It Works
              </a>
            </div>

            <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-slate-900/55 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Players</p>
                <p className="mt-1 text-lg font-bold text-white">2-9 per table</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/55 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Format</p>
                <p className="mt-1 text-lg font-bold text-white">No-limit action</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/55 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Twist</p>
                <p className="mt-1 text-lg font-bold text-white">Hidden discards</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-purple-500/40 bg-slate-900/50 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Example Hand
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">Simple preview</h2>
            <p className="mt-2 text-sm text-slate-300">
              You open with 5 cards. Community cards land. You cut weak cards street by street.
            </p>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Board (Flop)</p>
              <div className="mt-2 flex gap-2">
                {FLOP.map((card) => (
                  <Card key={card.id} card={card} compact />
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Your Hand</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {HERO_HAND.map((card) => (
                  <Card key={card.id} card={card} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="how-it-works" className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/55 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
            How It Works
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Step 1</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Get 5 cards</h3>
              <p className="mt-2 text-sm text-slate-300">Everyone starts deeper than Hold&apos;em.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Step 2</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Discard each street</h3>
              <p className="mt-2 text-sm text-slate-300">
                After flop, turn, and river, burn exactly one card face-down.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Step 3</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Showdown with 2</h3>
              <p className="mt-2 text-sm text-slate-300">
                Best 5-card hand wins from 2 hole cards plus 5 community cards.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div id="rules" className="relative mx-auto max-w-5xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/55 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Rules</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Quick hand flow
          </h2>
          <ol className="mt-5 space-y-3 text-sm text-slate-200 sm:text-base">
            {RULES.map((rule, index) => (
              <li
                key={rule}
                className="grid grid-cols-[1.8rem_1fr] items-start gap-3 rounded-lg border border-white/10 bg-slate-950/50 px-4 py-3 leading-relaxed"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-400/10 text-xs font-bold text-cyan-200">
                  {index + 1}
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
