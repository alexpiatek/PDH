import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/router';
import { Brain, CircleDot, LockKeyhole, ShieldCheck, Spade, type LucideIcon } from 'lucide-react';
import { logClientEvent } from '../lib/clientTelemetry';

const CARD_BASE = '/cards/modern-minimal';
const EARLY_ACCESS_SUCCESS_MESSAGE =
  'You\u2019re on the list. We\u2019ll send early access invites, test-night announcements, and launch updates.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

type EarlyAccessFormFields = {
  email: string;
  name: string;
  is18PlusConfirmed: boolean;
  marketingConsent: boolean;
};

type EarlyAccessFormErrors = Partial<Record<keyof EarlyAccessFormFields | 'form', string>>;

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

function validateEarlyAccessForm(fields: EarlyAccessFormFields): EarlyAccessFormErrors {
  const errors: EarlyAccessFormErrors = {};
  const email = fields.email.trim();

  if (!email || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!fields.is18PlusConfirmed) {
    errors.is18PlusConfirmed = 'Confirm you are 18 or older.';
  }

  if (!fields.marketingConsent) {
    errors.marketingConsent = 'Agree to receive Bondi Poker updates before joining.';
  }

  return errors;
}

function getTrackingFields() {
  if (typeof window === 'undefined') {
    return {
      source: 'landing_page',
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    source: 'landing_page',
    referrer: typeof document === 'undefined' ? undefined : document.referrer || undefined,
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
  };
}

function EarlyAccessForm() {
  const [fields, setFields] = useState<EarlyAccessFormFields>({
    email: '',
    name: '',
    is18PlusConfirmed: false,
    marketingConsent: false,
  });
  const [errors, setErrors] = useState<EarlyAccessFormErrors>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');

  const isSubmitting = status === 'submitting';
  const isSuccess = status === 'success';

  const updateField = <Key extends keyof EarlyAccessFormFields>(
    key: Key,
    value: EarlyAccessFormFields[Key]
  ) => {
    setFields((current) => ({
      ...current,
      [key]: value,
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      delete next.form;
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = validateEarlyAccessForm(fields);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setStatus('submitting');
    setErrors({});

    try {
      const response = await fetch('/api/early-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: fields.email.trim(),
          name: fields.name.trim() || undefined,
          is18PlusConfirmed: fields.is18PlusConfirmed,
          marketingConsent: fields.marketingConsent,
          ...getTrackingFields(),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;

      if (!response.ok || body?.ok === false) {
        setStatus('idle');
        setErrors({
          form: body?.error || 'Something went wrong while joining the list. Please try again.',
        });
        return;
      }

      logClientEvent('early_access_signup', {
        source: 'landing_page',
      });
      setStatus('success');
    } catch (error) {
      void error;
      setStatus('idle');
      setErrors({
        form: 'Something went wrong while joining the list. Please try again.',
      });
    }
  };

  if (isSuccess) {
    return (
      <div
        role="status"
        className="rounded-lg border border-teal-300/[0.55] bg-teal-400/[0.12] px-5 py-4 text-sm leading-6 text-teal-50 shadow-[0_0_24px_rgba(20,184,166,0.14)]"
      >
        {EARLY_ACCESS_SUCCESS_MESSAGE}
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="rounded-lg border border-white/[0.15] bg-zinc-950/[0.55] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur sm:p-5"
    >
      <div className="grid gap-4">
        <div>
          <label htmlFor="early-access-email" className="text-sm font-semibold text-white">
            Email address
          </label>
          <input
            id="early-access-email"
            type="email"
            required
            autoComplete="email"
            value={fields.email}
            disabled={isSubmitting}
            aria-invalid={errors.email ? 'true' : 'false'}
            aria-describedby={errors.email ? 'early-access-email-error' : undefined}
            onChange={(event) => updateField('email', event.target.value)}
            className="mt-2 block w-full rounded-md border border-white/[0.15] bg-black/[0.35] px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/25 disabled:cursor-not-allowed disabled:opacity-70"
            placeholder="you@example.com"
          />
          {errors.email ? (
            <p id="early-access-email-error" className="mt-2 text-sm text-amber-200">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="early-access-name" className="text-sm font-semibold text-white">
            First name or display name <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="early-access-name"
            type="text"
            autoComplete="given-name"
            maxLength={100}
            value={fields.name}
            disabled={isSubmitting}
            onChange={(event) => updateField('name', event.target.value)}
            className="mt-2 block w-full rounded-md border border-white/[0.15] bg-black/[0.35] px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/25 disabled:cursor-not-allowed disabled:opacity-70"
            placeholder="Display name"
          />
        </div>

        <div className="space-y-3">
          <label className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-3 text-sm leading-6 text-zinc-200">
            <input
              type="checkbox"
              required
              checked={fields.is18PlusConfirmed}
              disabled={isSubmitting}
              aria-invalid={errors.is18PlusConfirmed ? 'true' : 'false'}
              onChange={(event) => updateField('is18PlusConfirmed', event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/25 bg-black/[0.35] text-teal-400 focus:ring-teal-300"
            />
            <span>I confirm I&rsquo;m 18 or older.</span>
          </label>
          {errors.is18PlusConfirmed ? (
            <p className="pl-8 text-sm text-amber-200">{errors.is18PlusConfirmed}</p>
          ) : null}

          <label className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-3 text-sm leading-6 text-zinc-200">
            <input
              type="checkbox"
              required
              checked={fields.marketingConsent}
              disabled={isSubmitting}
              aria-invalid={errors.marketingConsent ? 'true' : 'false'}
              onChange={(event) => updateField('marketingConsent', event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/25 bg-black/[0.35] text-teal-400 focus:ring-teal-300"
            />
            <span>
              I agree to receive Bondi Poker updates, early access invites, and test-night
              announcements. I can unsubscribe anytime.
            </span>
          </label>
          {errors.marketingConsent ? (
            <p className="pl-8 text-sm text-amber-200">{errors.marketingConsent}</p>
          ) : null}
        </div>

        {errors.form ? (
          <p role="alert" className="text-sm text-amber-200">
            {errors.form}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-teal-200/70 bg-teal-400/[0.45] px-7 py-4 text-base font-semibold text-white shadow-[0_0_24px_rgba(20,184,166,0.22)] transition hover:bg-teal-300/[0.55] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? 'Joining...' : 'Join early access'}
        </button>

        <p className="text-xs leading-5 text-zinc-400">
          By signing up, you agree to receive Bondi Poker updates. You can unsubscribe anytime.
        </p>
      </div>
    </form>
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

            <div className="mt-9 max-w-lg">
              <EarlyAccessForm />
            </div>

            <div className="mt-4">
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
