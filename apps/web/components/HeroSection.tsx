'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, type PanInfo } from 'framer-motion';
import { ArrowUp, Sparkles } from 'lucide-react';

type Suit = 'S' | 'H' | 'D' | 'C';

type PokerCard = {
  id: string;
  rank: string;
  suit: Suit;
};

type HeroPhase = 'initial' | 'dealing' | 'flop' | 'prompt' | 'success';

type CardProps = {
  card: PokerCard;
  compact?: boolean;
  highlighted?: boolean;
};

const HERO_HAND: PokerCard[] = [
  { id: 'AS', rank: 'A', suit: 'S' },
  { id: 'KS', rank: 'K', suit: 'S' },
  { id: 'QS', rank: 'Q', suit: 'S' },
  { id: 'JS', rank: 'J', suit: 'S' },
  { id: '2H', rank: '2', suit: 'H' },
];

const FLOP: PokerCard[] = [
  { id: '10S', rank: '10', suit: 'S' },
  { id: '5D', rank: '5', suit: 'D' },
  { id: '9C', rank: '9', suit: 'C' },
];

const DISCARD_CARD_ID = '2H';
const RULES = [
  '2-9 players, standard 52-card deck.',
  'Each player is dealt 5 private cards pre-flop.',
  'Flop betting round, then each remaining player discards exactly 1 card.',
  'Turn betting round, then each remaining player discards exactly 1 card.',
  'River betting round, then each remaining player discards exactly 1 card.',
  'Showdown uses exactly 2 hole cards plus 5 community cards.',
  'Discards stay hidden for the entire hand.',
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

const fanRotation = (index: number, total: number) => (index - (total - 1) / 2) * 8;

const fanLift = (index: number, total: number) => {
  const distanceFromMiddle = Math.abs(index - (total - 1) / 2);
  return distanceFromMiddle * 6;
};

function Card({ card, compact = false, highlighted = false }: CardProps) {
  const suitSymbol = SUIT_SYMBOL[card.suit];
  const suitColor = SUIT_COLOR[card.suit];

  return (
    <div
      className={[
        'relative rounded-2xl border border-slate-300/90 bg-white text-slate-900 shadow-[0_14px_38px_rgba(15,23,42,0.28)]',
        compact ? 'h-[5.8rem] w-[4.15rem] sm:h-[6.5rem] sm:w-[4.6rem]' : 'h-[8.2rem] w-[5.6rem] sm:h-[9.5rem] sm:w-[6.5rem]',
        highlighted ? 'ring-2 ring-cyan-400/90 ring-offset-2 ring-offset-slate-950' : '',
      ].join(' ')}
    >
      <div className={['absolute left-2 top-1.5 text-[1rem] leading-none font-extrabold', suitColor].join(' ')}>
        <div>{card.rank}</div>
        <div className="text-[0.85rem]">{suitSymbol}</div>
      </div>

      <div
        className={[
          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-black leading-none',
          compact ? 'text-3xl' : 'text-5xl',
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

      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/70 via-transparent to-slate-300/15" />
    </div>
  );
}

export default function HeroSection() {
  const [phase, setPhase] = useState<HeroPhase>('initial');
  const [hand, setHand] = useState<PokerCard[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [runId, setRunId] = useState(0);

  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const queue = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    timersRef.current.push(timer);
  }, []);

  const startDemo = useCallback(() => {
    clearTimers();
    setRunId((prev) => prev + 1);
    setPhase('dealing');
    setShowBoard(false);
    setIsDiscarding(false);
    setHand([]);

    queue(() => setHand(HERO_HAND), 120);
    queue(() => {
      setShowBoard(true);
      setPhase('flop');
    }, 1300);
    queue(() => setPhase('prompt'), 1950);
  }, [clearTimers, queue]);

  const completeDiscard = useCallback(() => {
    if (isDiscarding || phase !== 'prompt') {
      return;
    }

    setIsDiscarding(true);
    setHand((prev) => prev.filter((card) => card.id !== DISCARD_CARD_ID));

    queue(() => {
      setPhase('success');
      setIsDiscarding(false);
    }, 420);
  }, [isDiscarding, phase, queue]);

  const onDiscardDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y < -105 || info.velocity.y < -900) {
        completeDiscard();
      }
    },
    [completeDiscard],
  );

  const ctaLabel = useMemo(() => {
    if (phase === 'initial') {
      return 'Try a Hand';
    }
    if (phase === 'success') {
      return 'Run It Again';
    }
    return 'Restart Demo';
  }, [phase]);

  const showHint = phase === 'prompt';

  return (
    <section className="relative isolate overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-36 right-[-8rem] h-[24rem] w-[24rem] rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-44 left-[-7rem] h-[22rem] w-[22rem] rounded-full bg-purple-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(34,211,238,0.17),transparent_34%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.15),transparent_40%)]" />
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12 lg:px-8">
        <div className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            Bondi Poker | Discard Hold&apos;em
          </p>

          <h1 className="font-sans text-4xl font-black leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Don&apos;t just play the hand you&apos;re dealt. Build it.
          </h1>

          <p className="max-w-xl text-base text-slate-300 sm:text-lg">
            The first poker game where you discard to survive.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startDemo}
              className="group relative inline-flex items-center justify-center rounded-xl border border-cyan-300/45 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 shadow-[0_0_0_0_rgba(34,211,238,0.35)] transition hover:-translate-y-0.5 hover:bg-cyan-400/25 hover:shadow-[0_14px_34px_-14px_rgba(34,211,238,0.75)]"
            >
              {ctaLabel}
            </button>

            <a
              href="#rules"
              className="inline-flex items-center justify-center rounded-xl border border-purple-400/45 bg-purple-500/10 px-5 py-3 text-sm font-semibold text-purple-100 transition hover:bg-purple-500/20"
            >
              See Rules
            </a>
          </div>

          <AnimatePresence mode="wait">
            {phase === 'success' ? (
              <motion.div
                key="success-copy"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                className="rounded-2xl border border-cyan-400/35 bg-slate-900/55 p-4 backdrop-blur"
              >
                <p className="text-lg font-semibold text-cyan-300">Hand Improved. That&apos;s Bondi Poker.</p>
                <a
                  href="/play"
                  className="mt-3 inline-flex items-center rounded-xl border border-cyan-300/60 bg-cyan-400/25 px-4 py-2 text-sm font-bold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.45)] transition hover:shadow-[0_0_34px_rgba(34,211,238,0.65)]"
                >
                  Play Real Games
                </a>
              </motion.div>
            ) : (
              <motion.p
                key="instruction-copy"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-sm text-slate-300"
              >
                {phase === 'initial'
                  ? 'Tap "Try a Hand" to run a live Discard Hold\'em moment.'
                  : 'Watch the board form, then drag the junk card up to burn it.'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="relative rounded-3xl border border-purple-500/40 bg-slate-900/45 p-4 shadow-2xl backdrop-blur-xl sm:p-6">
          <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-cyan-400/10 via-transparent to-purple-500/10" />

          <div className="relative min-h-[25rem] rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_40%_20%,rgba(34,211,238,0.16),transparent_35%),radial-gradient(circle_at_70%_80%,rgba(168,85,247,0.18),transparent_42%),linear-gradient(180deg,rgba(2,6,23,0.55),rgba(2,6,23,0.95))] p-4 sm:min-h-[27rem] sm:p-6">
            <div className="flex justify-center">
              <div className="flex items-center rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[0.64rem] font-medium uppercase tracking-[0.25em] text-cyan-300">
                Flop
              </div>
            </div>

            <div className="mt-3 flex min-h-[7.6rem] items-start justify-center gap-2 sm:gap-3">
              <AnimatePresence>
                {showBoard &&
                  FLOP.map((card, index) => (
                    <motion.div
                      key={`${runId}-${card.id}`}
                      initial={{ opacity: 0, y: -28, rotate: -8, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -20, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 180, damping: 20, delay: index * 0.12 }}
                    >
                      <Card card={card} compact />
                    </motion.div>
                  ))}
              </AnimatePresence>
            </div>

            <div className="absolute inset-x-0 bottom-5 flex justify-center px-2 sm:bottom-6">
              <LayoutGroup id={`hand-${runId}`}>
                <div className="flex items-end justify-center">
                  <AnimatePresence>
                    {hand.map((card, index) => {
                      const draggable = showHint && card.id === DISCARD_CARD_ID && !isDiscarding;
                      const total = hand.length;

                      return (
                        <motion.div
                          key={`${runId}-${card.id}`}
                          layout
                          layoutId={`hero-card-${runId}-${card.id}`}
                          initial={{ opacity: 0, y: 96, scale: 0.86, rotate: 0 }}
                          animate={{
                            opacity: 1,
                            y: fanLift(index, total),
                            rotate: fanRotation(index, total),
                            scale: 1,
                            x: 0,
                            filter: 'blur(0px)',
                          }}
                          exit={{
                            opacity: 0,
                            y: -180,
                            rotate: -14,
                            scale: 0.56,
                            filter: 'blur(6px)',
                            transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
                          }}
                          transition={{
                            type: 'spring',
                            stiffness: draggable ? 250 : 290,
                            damping: draggable ? 24 : 28,
                            mass: 1.1,
                            delay: phase === 'dealing' ? index * 0.1 : 0,
                          }}
                          drag={draggable ? 'y' : false}
                          dragElastic={0.16}
                          dragMomentum={false}
                          dragSnapToOrigin
                          dragTransition={{
                            bounceStiffness: 230,
                            bounceDamping: 24,
                          }}
                          onDragEnd={draggable ? onDiscardDragEnd : undefined}
                          whileDrag={
                            draggable
                              ? {
                                  y: -8,
                                  rotate: 0,
                                  scale: 1.06,
                                  boxShadow: '0px 38px 55px rgba(3,7,18,0.62)',
                                }
                              : undefined
                          }
                          style={{ zIndex: index + 1, touchAction: draggable ? 'none' : 'auto' }}
                          className="relative -ml-7 first:ml-0 sm:-ml-5 md:-ml-3"
                        >
                          <Card card={card} highlighted={draggable} />

                          <AnimatePresence>
                            {showHint && card.id === DISCARD_CARD_ID ? (
                              <motion.div
                                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                animate={{
                                  opacity: 1,
                                  y: 0,
                                  scale: [1, 1.02, 1],
                                }}
                                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                transition={{
                                  opacity: { duration: 0.2 },
                                  y: { duration: 0.25 },
                                  scale: { repeat: Infinity, duration: 1.4, ease: 'easeInOut' },
                                }}
                                className="absolute -top-[5.9rem] left-1/2 w-[15rem] -translate-x-1/2 rounded-xl border border-purple-400/55 bg-slate-900/95 p-3 text-left text-[0.74rem] leading-relaxed text-cyan-100 shadow-[0_0_34px_rgba(168,85,247,0.26)]"
                              >
                                <div className="flex items-start gap-2">
                                  <motion.span
                                    animate={{ y: [0, -4, 0] }}
                                    transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-cyan-300"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </motion.span>
                                  <p>
                                    You have a Royal Flush draw. Drag this card UP to discard it.
                                  </p>
                                </div>
                                <div className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-purple-400/55 bg-slate-900/95" />
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </LayoutGroup>
            </div>
          </div>
        </div>
      </div>

      <div id="rules" className="relative mx-auto max-w-5xl scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/55 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Rules</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Easy-to-read hand flow
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
