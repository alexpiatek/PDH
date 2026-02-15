const RULES = [
  '2-9 players at each table.',
  'Deal 5 private cards to every active player.',
  'After flop, turn, and river, each player discards exactly 1 card.',
  'Discards remain hidden until the hand ends.',
  'Showdown uses exactly 2 hole cards plus 5 board cards.',
] as const;

const FLOW = [
  {
    title: 'Create or join in seconds',
    body: 'Start a private table with a short invite code, or drop into a table from your recent list.',
  },
  {
    title: 'Betting stays familiar',
    body: 'No-limit betting rounds run the way players expect, with one high-pressure twist each street.',
  },
  {
    title: 'Discard to survive',
    body: 'You shrink from five hole cards to two by showdown, forcing sharper decisions and tighter reads.',
  },
] as const;

const STATS = [
  { label: 'Table Size', value: '2-9 players' },
  { label: 'Invite Code', value: '6 characters' },
  { label: 'Pace', value: 'Fast rounds' },
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
            Bondi Poker | Discard Hold&apos;em
          </p>

          <h1 className="mx-auto mt-5 max-w-3xl font-[var(--font-display)] text-4xl font-semibold leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
            A premium poker lobby with a high-pressure twist.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-300 sm:text-lg">
            Start with 5 hole cards, discard after every post-flop street, and reach showdown with
            exactly 2. Same fundamentals, sharper decisions.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="/play"
              className="inline-flex items-center justify-center rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/30"
            >
              Enter Lobby
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-xl border border-teal-300/45 bg-teal-500/15 px-6 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-500/25"
            >
              How It Works
            </a>
          </div>

          <div className="mx-auto mt-9 grid max-w-3xl gap-3 sm:grid-cols-3">
            {STATS.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-zinc-300/20 bg-zinc-900/70 px-4 py-3 text-left"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">{item.label}</p>
                <p className="mt-1 text-lg font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div id="how-it-works" className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
            How It Works
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {FLOW.map((step, index) => (
              <div
                key={step.title}
                className="rounded-xl border border-zinc-300/20 bg-zinc-950/60 p-4"
              >
                <p className="text-xs uppercase tracking-[0.15em] text-zinc-400">Step {index + 1}</p>
                <h3 className="mt-1 font-[var(--font-display)] text-lg font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-300">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div id="rules" className="relative mx-auto max-w-5xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-amber-300/20 bg-zinc-900/65 p-5 backdrop-blur sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Rules</p>
          <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Quick Hand Flow
          </h2>
          <ol className="mt-5 space-y-3 text-sm text-zinc-200 sm:text-base">
            {RULES.map((rule, index) => (
              <li
                key={rule}
                className="grid grid-cols-[1.8rem_1fr] items-start gap-3 rounded-lg border border-zinc-300/20 bg-zinc-950/60 px-4 py-3 leading-relaxed"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/10 text-xs font-bold text-amber-100">
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
