const MICRO_BULLETS = [
  'Classic No-Limit Hold’em betting',
  'Mandatory hidden discards after each post-flop street',
  'Real-time multiplayer (2-9 players)',
] as const;

const EXPLAINER_STEPS = [
  'You’re dealt 5 hole cards.',
  'Flop -> bet -> everyone still in discards 1 (hidden).',
  'Turn -> bet -> discard 1 (hidden).',
  'River -> bet -> discard 1 (hidden).',
  'Showdown with 2 hole cards: best 5-card hand wins (2 hole + 5 board).',
] as const;

const WHY_DIFFERENT = [
  'Information pressure: everyone’s range compresses toward a 2-card showdown.',
  'Bigger decisions: manage made hands, draws, blockers, and deception.',
  'Same betting, new edge: No-Limit Hold’em structure with a radically different layer.',
] as const;

const FAQ = [
  {
    q: 'Is this still poker?',
    a: 'Yes. Standard 52-card deck, No-Limit Hold’em betting, best 5-card hand wins.',
  },
  {
    q: 'Do discards ever show?',
    a: 'No. Discards are face-down and never revealed.',
  },
  {
    q: 'How many players?',
    a: 'Tables support 2-9 players.',
  },
  {
    q: 'What do I need to know to start?',
    a: 'If you know Hold’em betting, you’re ready. New action: discard 1 after flop/turn/river.',
  },
] as const;

export default function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-35"
          style={{ backgroundImage: "url('/Casino floor background.png')" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(251,191,36,0.22),transparent_36%),radial-gradient(circle_at_82%_85%,rgba(20,184,166,0.16),transparent_42%),linear-gradient(180deg,rgba(6,10,20,0.72),rgba(3,6,14,0.92))]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-amber-200/20 bg-zinc-950/65 p-6 text-center backdrop-blur-xl sm:p-9">
          <p className="inline-flex items-center rounded-full border border-amber-300/35 bg-amber-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
            BondiPoker
          </p>

          <h1 className="mx-auto mt-5 max-w-4xl font-[var(--font-display)] text-4xl font-semibold leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Don&apos;t just play the hand you&apos;re dealt. Build it.
          </h1>

          <p className="mx-auto mt-5 max-w-3xl text-base text-zinc-300 sm:text-lg">
            Start with <strong>5 hole cards</strong>. After the <strong>flop, turn, and river</strong>,
            you must <strong>discard 1 card face-down</strong>. You reach showdown with{' '}
            <strong>only 2</strong>. No one ever sees what you threw away.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="/play"
              className="inline-flex items-center justify-center rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/30"
            >
              Play Online
            </a>
            <a
              href="#twist"
              className="inline-flex items-center justify-center rounded-xl border border-teal-300/45 bg-teal-500/15 px-6 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-500/25"
            >
              Learn the Twist in 30s
            </a>
          </div>

          <ul className="mx-auto mt-8 max-w-3xl space-y-2 text-left text-sm text-zinc-200">
            {MICRO_BULLETS.map((item) => (
              <li key={item} className="rounded-xl border border-zinc-300/20 bg-zinc-900/70 px-4 py-2.5">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div id="twist" className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
            30-Second Explainer
          </p>
          <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            How BondiPoker Works
          </h2>
          <ol className="mt-5 space-y-3 text-sm text-zinc-200 sm:text-base">
            {EXPLAINER_STEPS.map((step, index) => (
              <li
                key={step}
                className="grid grid-cols-[1.8rem_1fr] items-start gap-3 rounded-lg border border-zinc-300/20 bg-zinc-950/60 px-4 py-3 leading-relaxed"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/10 text-xs font-bold text-amber-100">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-xl border border-teal-300/25 bg-teal-500/10 px-4 py-3 text-sm text-teal-100">
            <strong>Key rule:</strong> Discards are never revealed. Not now, not later.
          </p>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
            Why It&apos;s Different
          </p>
          <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Hold&apos;em pressure with an extra layer of mind games.
          </h2>
          <p className="mt-3 text-sm text-zinc-300 sm:text-base">
            Every street forces a decision: what do I keep, what do I kill, and what do I want them
            to think I kept?
          </p>
          <ul className="mt-5 space-y-3 text-sm text-zinc-200 sm:text-base">
            {WHY_DIFFERENT.map((item) => (
              <li key={item} className="rounded-lg border border-zinc-300/20 bg-zinc-950/60 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
            Strategy Tease
          </p>
          <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Discarding is the new bluff.
          </h2>
          <p className="mt-3 text-sm text-zinc-300 sm:text-base">
            Ditch a pair for nut-draw equity? Keep blockers and throw away showdown value? Protect
            your range or go for maximum chaos?
          </p>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-emerald-300/25 bg-emerald-500/10 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
            Fair Play
          </p>
          <p className="mt-2 text-sm text-emerald-100 sm:text-base">
            Deterministic engine + authoritative server = consistent rules and clean outcomes.
          </p>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">FAQ</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {FAQ.map((item) => (
              <article
                key={item.q}
                className="rounded-xl border border-zinc-300/20 bg-zinc-950/60 p-4 text-sm"
              >
                <h3 className="font-semibold text-white">{item.q}</h3>
                <p className="mt-2 text-zinc-300">{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-20 text-center sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/25 bg-zinc-950/70 p-6 backdrop-blur sm:p-8">
          <h2 className="font-[var(--font-display)] text-2xl font-semibold text-white sm:text-3xl">
            Ready to feel the squeeze?
          </h2>
          <a
            href="/play"
            className="mt-5 inline-flex items-center justify-center rounded-xl border border-amber-300/60 bg-amber-400/25 px-6 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/35"
          >
            Play BondiPoker Now
          </a>
        </div>
      </div>
    </section>
  );
}
