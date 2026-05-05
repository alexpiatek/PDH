import { useState } from 'react';
import { useRouter } from 'next/router';
import { Brain, CircleDot, LockKeyhole, ShieldCheck, Spade, type LucideIcon } from 'lucide-react';
import { logClientEvent } from '../lib/clientTelemetry';

const CARD_BASE = '/cards/modern-minimal';

type CardFace = {
  src: string;
  alt: string;
};

type FlowRow = {
  street: string;
  cards: CardFace[];
  note?: string;
};

type WhyCard = {
  title: string;
  copy: string;
  icon: LucideIcon;
};

const STARTING_HAND: CardFace[] = [
  { src: `${CARD_BASE}/ace_of_spades.png`, alt: 'Ace of spades' },
  { src: `${CARD_BASE}/king_of_hearts.png`, alt: 'King of hearts' },
  { src: `${CARD_BASE}/queen_of_clubs.png`, alt: 'Queen of clubs' },
  { src: `${CARD_BASE}/jack_of_diamonds.png`, alt: 'Jack of diamonds' },
  { src: `${CARD_BASE}/10_of_spades.png`, alt: 'Ten of spades' },
];

const FLOW_ROWS: FlowRow[] = [
  {
    street: 'Flop',
    cards: [
      { src: `${CARD_BASE}/7_of_clubs.png`, alt: 'Seven of clubs' },
      { src: `${CARD_BASE}/8_of_diamonds.png`, alt: 'Eight of diamonds' },
      { src: `${CARD_BASE}/2_of_hearts.png`, alt: 'Two of hearts' },
    ],
  },
  {
    street: 'Turn',
    cards: [
      { src: `${CARD_BASE}/7_of_clubs.png`, alt: 'Seven of clubs' },
      { src: `${CARD_BASE}/8_of_diamonds.png`, alt: 'Eight of diamonds' },
      { src: `${CARD_BASE}/2_of_hearts.png`, alt: 'Two of hearts' },
      { src: `${CARD_BASE}/king_of_spades.png`, alt: 'King of spades' },
    ],
  },
  {
    street: 'River',
    cards: [
      { src: `${CARD_BASE}/7_of_clubs.png`, alt: 'Seven of clubs' },
      { src: `${CARD_BASE}/8_of_diamonds.png`, alt: 'Eight of diamonds' },
      { src: `${CARD_BASE}/2_of_hearts.png`, alt: 'Two of hearts' },
      { src: `${CARD_BASE}/king_of_spades.png`, alt: 'King of spades' },
      { src: `${CARD_BASE}/5_of_diamonds.png`, alt: 'Five of diamonds' },
    ],
  },
  {
    street: 'Showdown',
    cards: [
      { src: `${CARD_BASE}/ace_of_spades.png`, alt: 'Ace of spades' },
      { src: `${CARD_BASE}/queen_of_hearts.png`, alt: 'Queen of hearts' },
    ],
    note: '2 hole cards',
  },
];

const WHY_CARDS: WhyCard[] = [
  {
    title: "Classic Hold'em betting",
    copy: "All the strategy and depth of Texas Hold'em with familiar no-limit betting.",
    icon: Spade,
  },
  {
    title: 'Hidden discards after every post-flop street',
    copy: 'Discard one hidden card after the flop, turn, and river. Information stays buried.',
    icon: LockKeyhole,
  },
  {
    title: 'Information pressure builds toward showdown',
    copy: 'With each discard round, uncertainty grows and every decision matters more.',
    icon: Brain,
  },
  {
    title: 'Deterministic engine and authoritative server',
    copy: 'Built for fair play, consistent outcomes, and a smooth real-time experience.',
    icon: ShieldCheck,
  },
];

const RULES = [
  '2-9 players, standard 52-card deck',
  'Each player is dealt 5 hole cards',
  'No discards pre-flop',
  'After the flop, each remaining player discards 1 hidden card',
  'After the turn, each remaining player discards 1 hidden card',
  'After the river, each remaining player discards 1 hidden card',
  'Players reach showdown with 2 hole cards',
  'Best 5-card hand from 2 hole cards + 5 board cards wins',
  'Discards stay face-down and are never revealed',
  'No-limit betting with standard min-raise behavior',
] as const;

function CardImage({ card, className = '' }: { card: CardFace; className?: string }) {
  return (
    <img
      src={card.src}
      alt={card.alt}
      className={`aspect-[5/7] w-10 rounded-md border border-zinc-950/25 bg-stone-100 object-cover shadow-[0_9px_18px_rgba(0,0,0,0.45)] sm:w-12 lg:w-14 ${className}`}
    />
  );
}

function DiscardCard() {
  return (
    <div
      aria-label="Hidden discard"
      className="aspect-[5/7] w-10 rounded-md border border-amber-300/60 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(5,9,12,0.96))] shadow-[0_9px_18px_rgba(0,0,0,0.45)] ring-1 ring-black/40 sm:w-12 lg:w-14"
    >
      <div className="flex h-full items-center justify-center text-xl text-amber-300/80">
        <Spade aria-hidden="true" className="h-5 w-5" />
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-center gap-5 text-center">
      <span className="hidden h-px w-20 bg-gradient-to-r from-transparent to-amber-300/70 sm:block" />
      <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.42em] text-amber-200 sm:text-sm">
        {children}
      </h2>
      <span className="hidden h-px w-20 bg-gradient-to-l from-transparent to-amber-300/70 sm:block" />
    </div>
  );
}

function FlowDiagram() {
  return (
    <div className="relative mx-auto w-full max-w-[660px] py-2 lg:py-0">
      <div className="pointer-events-none absolute inset-x-0 top-20 hidden h-[360px] rounded-[999px] border border-amber-500/30 bg-teal-950/20 shadow-[inset_0_0_70px_rgba(20,184,166,0.09)] lg:block" />
      <div className="pointer-events-none absolute inset-x-8 top-24 hidden h-[344px] rounded-[999px] border border-amber-500/20 lg:block" />

      <div className="relative space-y-5 sm:space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3 font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
            <span className="h-px w-10 bg-amber-300/45" />
            Start: 5 hole cards
            <span className="h-px w-10 bg-amber-300/45" />
          </div>
          <div className="flex justify-center gap-1.5 sm:gap-2">
            {STARTING_HAND.map((card) => (
              <CardImage key={card.alt} card={card} />
            ))}
          </div>
        </div>

        {FLOW_ROWS.map((row, index) => (
          <div
            key={row.street}
            className="relative grid grid-cols-[82px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[112px_minmax(0,1fr)]"
          >
            <div className="flex items-center justify-end gap-2 font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
              <CircleDot aria-hidden="true" className="h-3 w-3 text-teal-300" />
              {row.street}
            </div>

            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="flex min-w-0 gap-1.5 sm:gap-2">
                {row.cards.map((card) => (
                  <CardImage
                    key={`${row.street}-${card.alt}`}
                    card={card}
                    className={row.street === 'Showdown' ? 'lg:w-[3.4rem]' : ''}
                  />
                ))}
              </div>

              {row.street !== 'Showdown' ? (
                <>
                  <div className="h-px w-5 shrink-0 bg-gradient-to-r from-teal-300/70 to-transparent sm:w-8" />
                  <DiscardCard />
                  <div className="hidden shrink-0 font-[var(--font-display)] text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-200 sm:block">
                    Discard 1
                  </div>
                </>
              ) : (
                <div className="shrink-0 font-[var(--font-display)] text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-200">
                  {row.note}
                </div>
              )}
            </div>

            {index < FLOW_ROWS.length - 1 ? (
              <div className="absolute -bottom-4 left-[calc(82px+42%)] hidden h-5 w-px bg-amber-300/50 sm:left-[calc(112px+36%)] sm:block" />
            ) : null}
          </div>
        ))}

        <div className="pl-[95px] text-xs font-semibold text-teal-200 sm:pl-[128px]">
          Best 5-card hand from 2 hole cards + 5 board cards wins.
        </div>
      </div>
    </div>
  );
}

export default function HeroSection() {
  const router = useRouter();
  const [playNowLoading, setPlayNowLoading] = useState(false);

  const handlePlayNow = async () => {
    if (playNowLoading) {
      return;
    }

    setPlayNowLoading(true);
    logClientEvent('landing_cta', {
      cta: 'hero_quick_play',
      destination: '/play',
    });
    try {
      await router.push('/play');
    } finally {
      setPlayNowLoading(false);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#03080b] text-zinc-100">
      <section className="relative isolate border-b border-white/10">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-[0.08]"
            style={{ backgroundImage: "url('/Casino floor background.png')" }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_38%,rgba(20,184,166,0.16),transparent_30%),radial-gradient(circle_at_18%_22%,rgba(251,191,36,0.08),transparent_26%),linear-gradient(180deg,rgba(3,8,11,0.94),rgba(2,7,9,0.98))]" />
        </div>

        <header className="relative z-10 border-b border-amber-300/55">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-7 sm:px-8">
            <a
              href="/"
              className="font-[var(--font-display)] text-xl font-semibold uppercase tracking-[0.42em] text-amber-200 sm:text-2xl"
            >
              Bondi Poker
            </a>
            <button
              type="button"
              onClick={() => {
                void handlePlayNow();
              }}
              disabled={playNowLoading}
              className="hidden rounded-md border border-amber-300/50 px-4 py-2 font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.16em] text-amber-100 transition hover:border-teal-300/70 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
            >
              {playNowLoading ? 'Opening' : 'Quick Play'}
            </button>
          </div>
        </header>

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-6 py-14 sm:px-8 sm:py-16 lg:min-h-[640px] lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
          <div className="max-w-xl">
            <div className="inline-flex rounded-lg border border-teal-300/70 bg-teal-400/10 px-5 py-2 font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.22em] text-teal-200 shadow-[0_0_24px_rgba(20,184,166,0.12)]">
              PDH - Discard Hold&apos;em
            </div>

            <h1 className="mt-7 font-[var(--font-serif)] text-6xl font-semibold leading-[0.9] text-white sm:text-7xl lg:text-[5.8rem]">
              A new kind of online Hold&apos;em.
            </h1>

            <p className="mt-7 max-w-lg text-lg leading-8 text-zinc-300 sm:text-xl">
              Real-time multiplayer poker with a twist: start with 5 hole cards, discard one after
              the flop, turn, and river, and reach showdown with just 2 hole cards.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <a
                href="mailto:updates@bondipoker.online?subject=Bondi%20Poker%20updates"
                onClick={() =>
                  logClientEvent('landing_cta', {
                    cta: 'hero_updates_mailto',
                    destination: 'mailto',
                  })
                }
                className="inline-flex items-center justify-center rounded-md border border-teal-200/70 bg-teal-400/45 px-7 py-4 text-base font-semibold text-white shadow-[0_0_24px_rgba(20,184,166,0.22)] transition hover:bg-teal-300/55"
              >
                Sign up for updates
              </a>
              <button
                type="button"
                onClick={() => {
                  void handlePlayNow();
                }}
                disabled={playNowLoading}
                className="inline-flex items-center justify-center rounded-md border border-amber-300/70 bg-transparent px-7 py-4 text-base font-semibold text-amber-100 transition hover:border-teal-200 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {playNowLoading ? 'Opening...' : 'Quick Play'}
              </button>
            </div>
          </div>

          <FlowDiagram />
        </div>
      </section>

      <section className="border-b border-white/10 bg-zinc-950/55 px-6 py-12 sm:px-8 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <SectionTitle>Why It&apos;s Different</SectionTitle>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {WHY_CARDS.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="rounded-lg border border-white/15 bg-white/[0.035] px-6 py-7 text-center shadow-[0_20px_55px_rgba(0,0,0,0.18)]"
                >
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-teal-300/40 bg-teal-400/10 text-teal-300">
                    <Icon aria-hidden="true" className="h-9 w-9" strokeWidth={1.6} />
                  </div>
                  <h3 className="mt-7 text-lg font-semibold leading-snug text-white">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-zinc-300">{item.copy}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-b border-amber-300/20 px-6 py-12 sm:px-8 lg:py-14"
      >
        <div className="mx-auto max-w-6xl">
          <SectionTitle>How It Works</SectionTitle>

          <ol className="mt-10 grid gap-x-12 lg:grid-cols-2">
            {RULES.map((rule, index) => (
              <li
                key={rule}
                className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-4 border-b border-white/10 py-4"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-teal-300/35 bg-teal-400/10 font-[var(--font-display)] text-sm font-semibold text-teal-200">
                  {index + 1}
                </span>
                <span className="text-lg leading-7 text-zinc-100">{rule}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="relative px-6 py-14 sm:px-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_60%,rgba(20,184,166,0.07),transparent_32%),radial-gradient(circle_at_88%_70%,rgba(251,191,36,0.05),transparent_34%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold uppercase tracking-[0.42em] text-amber-200">
              Bondi Poker
            </div>
            <div className="mt-6 flex max-w-sm items-center gap-4">
              <span className="h-px flex-1 bg-amber-300/40" />
              <Spade aria-hidden="true" className="h-5 w-5 text-teal-300" />
              <span className="h-px flex-1 bg-amber-300/40" />
            </div>
            <div className="mt-7 font-[var(--font-display)] text-xs uppercase tracking-[0.35em] text-zinc-400">
              Think deeper. Discard wisely. Win.
            </div>
          </div>

          <div className="text-sm leading-7 text-zinc-300 lg:pt-2">
            <p>Bondi Poker is a skill-based online poker game. Play responsibly.</p>
            <div className="mt-8 border-t border-white/15 pt-7 text-zinc-400">
              &copy; 2026 Bondi Poker. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
