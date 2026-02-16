import { useState } from 'react';
import { useRouter } from 'next/router';
import { logClientEvent } from '../lib/clientTelemetry';

const TWIST_BULLETS = [
  'Deal 5 hole cards.',
  'Discard 1 after each street.',
  'Showdown with 2. Discards stay hidden.',
] as const;

const ADDICTIVE_BULLETS = [
  'Every street, you kill a card.',
  'You bluff with what you bury.',
  'Same bets. New mind game.',
] as const;

const FAQ_ITEMS = [
  {
    q: "Is this still Hold'em?",
    a: "Yes. Hold'em betting and board cards, plus one hidden discard after flop, turn, and river.",
  },
  {
    q: 'When do I discard?',
    a: 'After flop betting, after turn betting, and after river betting. One card each time, face-down.',
  },
  {
    q: 'Do discards ever show?',
    a: 'No. Hidden discards stay private for the entire hand, including showdown.',
  },
  {
    q: 'How long is a hand?',
    a: "About the pace of normal Hold'em: preflop, flop, turn, river, showdown.",
  },
  {
    q: 'Is it play money or real money?',
    a: 'Play-money tables right now.',
  },
  {
    q: 'Is it fair?',
    a: 'Cards are dealt server-side, shuffles are random, and anti-cheat checks run every hand. No one can view your hidden discards.',
  },
  {
    q: 'Can I play on mobile?',
    a: 'Yes. The table runs in mobile browsers with tap controls.',
  },
  {
    q: 'How many players?',
    a: 'Tables support 2-9 players.',
  },
] as const;

export default function HeroSection() {
  const router = useRouter();
  const [playNowLoading, setPlayNowLoading] = useState(false);

  const handlePlayNow = async () => {
    if (playNowLoading) {
      return;
    }

    setPlayNowLoading(true);
    logClientEvent('landing_cta', {
      cta: 'hero_primary_play_online',
      destination: '/play',
    });
    try {
      await router.push('/play');
    } finally {
      setPlayNowLoading(false);
    }
  };

  return (
    <section className="relative isolate overflow-hidden text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url('/Casino floor background.png')" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(217,119,6,0.18),transparent_32%),radial-gradient(circle_at_80%_85%,rgba(120,53,15,0.2),transparent_34%),linear-gradient(180deg,rgba(4,6,12,0.9),rgba(2,3,7,0.97))]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pt-20 sm:px-6 sm:pt-24 lg:px-8">
        <div className="rounded-3xl border border-amber-200/15 bg-zinc-950/72 px-6 py-10 text-center backdrop-blur-xl sm:px-10 sm:py-14">
          <h1 className="mx-auto max-w-4xl font-[var(--font-display)] text-5xl font-semibold leading-[0.9] tracking-tight text-white sm:text-6xl lg:text-7xl">
            Five cards. Three discards. Two truths.
          </h1>

          <div className="mx-auto mt-5 max-w-2xl text-sm text-zinc-300 sm:text-base">
            Hold&apos;em betting. Discard one each street, forever hidden.
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => {
                void handlePlayNow();
              }}
              disabled={playNowLoading}
              className="inline-flex items-center justify-center rounded-xl border border-amber-300/60 bg-amber-400/25 px-6 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {playNowLoading ? 'Opening...' : 'Play Now'}
            </button>
            <a
              href="#twist"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-300/45 bg-zinc-800/55 px-6 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700/60"
            >
              Learn the Twist
            </a>
          </div>
          <div className="mt-4 text-xs uppercase tracking-[0.18em] text-zinc-400">
            Fast hands. High stakes.
          </div>
        </div>
      </div>

      <div id="twist" className="relative mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <h2 className="font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            The Twist
          </h2>
          <ul className="mt-5 space-y-3 text-sm text-zinc-200 sm:text-base">
            {TWIST_BULLETS.map((step) => (
              <li key={step} className="rounded-lg border border-zinc-300/20 bg-zinc-950/60 px-4 py-3">
                {step}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <h2 className="font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Why It&apos;s Addictive
          </h2>
          <ul className="mt-5 space-y-3 text-sm text-zinc-200 sm:text-base">
            {ADDICTIVE_BULLETS.map((item) => (
              <li key={item} className="rounded-lg border border-zinc-300/20 bg-zinc-950/60 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <h2 className="font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            FAQ
          </h2>
          <div className="mt-5 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.q}
                className="group rounded-lg border border-zinc-300/20 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200"
              >
                <summary className="cursor-pointer list-none font-semibold text-white marker:content-none">
                  <span className="flex items-center justify-between gap-4">
                    <span>{item.q}</span>
                    <span className="text-zinc-400 transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <div className="pt-2 text-zinc-300">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-20 text-center sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/25 bg-zinc-950/70 p-6 backdrop-blur sm:p-8">
          <div className="font-[var(--font-display)] text-2xl font-semibold text-white sm:text-3xl">
            Ready to feel the squeeze?
          </div>
          <a
            href="/play"
            onClick={() =>
              logClientEvent('landing_cta', {
                cta: 'hero_footer_play_now',
                destination: '/play',
              })
            }
            className="mt-5 inline-flex items-center justify-center rounded-xl border border-amber-300/60 bg-amber-400/25 px-6 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/35"
          >
            Play Now
          </a>
        </div>
      </div>
    </section>
  );
}
