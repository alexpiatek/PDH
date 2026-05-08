import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Brain,
  CircleDot,
  ExternalLink,
  LockKeyhole,
  ShieldCheck,
  Spade,
  type LucideIcon,
} from 'lucide-react';
import { BondiPokerLogo } from './BondiPokerLogo';
import { logClientEvent } from '../lib/clientTelemetry';

const CARD_BASE = '/cards/modern-minimal';
const EARLY_ACCESS_SUCCESS_MESSAGE =
  'You\u2019re on the list. We\u2019ll send early access invites, test-night announcements, and launch updates.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() || 'https://discord.gg/YOUR_INVITE_CODE';

type CardFace = {
  src: string;
  alt: string;
  code: string;
};

type FlowRow = {
  label: string;
  holeLabel: string;
  holeCards: CardFace[];
  discarded?: CardFace;
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

const ACE_SPADES = {
  src: `${CARD_BASE}/ace_of_spades.png`,
  alt: 'Ace of spades',
  code: 'A\u2660',
};
const KING_HEARTS = {
  src: `${CARD_BASE}/king_of_hearts.png`,
  alt: 'King of hearts',
  code: 'K\u2665',
};
const QUEEN_CLUBS = {
  src: `${CARD_BASE}/queen_of_clubs.png`,
  alt: 'Queen of clubs',
  code: 'Q\u2663',
};
const JACK_DIAMONDS = {
  src: `${CARD_BASE}/jack_of_diamonds.png`,
  alt: 'Jack of diamonds',
  code: 'J\u2666',
};
const TEN_SPADES = {
  src: `${CARD_BASE}/10_of_spades.png`,
  alt: 'Ten of spades',
  code: '10\u2660',
};
const STARTING_HAND: CardFace[] = [ACE_SPADES, KING_HEARTS, QUEEN_CLUBS, JACK_DIAMONDS, TEN_SPADES];

const FLOW_ROWS: FlowRow[] = [
  {
    label: 'Flop',
    holeLabel: '4 hole cards',
    holeCards: [ACE_SPADES, KING_HEARTS, QUEEN_CLUBS, JACK_DIAMONDS],
    discarded: TEN_SPADES,
  },
  {
    label: 'Turn',
    holeLabel: '3 hole cards',
    holeCards: [ACE_SPADES, KING_HEARTS, QUEEN_CLUBS],
    discarded: JACK_DIAMONDS,
  },
  {
    label: 'River',
    holeLabel: '2 hole cards',
    holeCards: [ACE_SPADES, KING_HEARTS],
    discarded: QUEEN_CLUBS,
  },
  {
    label: 'Showdown',
    holeLabel: '2 hole cards',
    holeCards: [ACE_SPADES, KING_HEARTS],
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
      className={`aspect-[5/7] w-9 rounded-md border border-zinc-950/25 bg-stone-100 object-cover shadow-[0_9px_18px_rgba(0,0,0,0.45)] sm:w-10 lg:w-10 xl:w-11 ${className}`}
    />
  );
}

function DiscardCard({ card }: { card: CardFace }) {
  return (
    <div className="flex items-center gap-3">
      <div className="hidden h-px min-w-8 flex-1 bg-gradient-to-r from-teal-300/70 to-transparent sm:block" />
      <div
        role="img"
        aria-label={`Discarded ${card.alt}`}
        title={`Discarded ${card.code}`}
        className="flex aspect-[5/7] w-9 items-center justify-center rounded-md border border-amber-300/75 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.14),transparent_48%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(3,7,10,0.98))] shadow-[0_9px_18px_rgba(0,0,0,0.45),inset_0_0_0_4px_rgba(251,191,36,0.12)] sm:w-10 lg:w-10 xl:w-11"
      >
        <Spade
          aria-hidden="true"
          className="h-4 w-4 text-amber-200 sm:h-5 sm:w-5"
          strokeWidth={1.6}
        />
      </div>
      <div className="whitespace-nowrap font-[var(--font-display)] text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-amber-200 sm:text-[0.62rem] lg:text-[0.66rem]">
        Discard 1
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
    <div className="relative mx-auto w-full max-w-[650px] py-1 lg:py-0">
      <div className="pointer-events-none absolute inset-x-0 top-20 hidden h-[300px] rounded-[999px] border border-amber-500/28 bg-teal-950/25 shadow-[inset_0_0_80px_rgba(20,184,166,0.12)] lg:block xl:h-[320px]" />
      <div className="pointer-events-none absolute inset-x-10 top-24 hidden h-[276px] rounded-[999px] border border-amber-500/16 lg:block xl:h-[296px]" />

      <div className="relative space-y-3 sm:space-y-4">
        <div>
          <div className="flex items-center justify-center gap-3 font-[var(--font-display)] text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-amber-200 sm:text-xs sm:tracking-[0.2em]">
            <span className="hidden h-px w-12 bg-amber-300/45 sm:block" />
            Start: 5 hole cards
            <span className="hidden h-px w-12 bg-amber-300/45 sm:block" />
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:gap-2 lg:gap-2.5">
            {STARTING_HAND.map((card) => (
              <CardImage key={card.alt} card={card} />
            ))}
          </div>
        </div>

        {FLOW_ROWS.map((row) => (
          <div
            key={row.label}
            className="relative grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[106px_minmax(190px,1fr)] lg:grid-cols-[118px_minmax(210px,1fr)_minmax(190px,0.88fr)]"
          >
            <div className="flex items-center gap-2 font-[var(--font-display)] text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-amber-200 sm:gap-3 sm:text-[0.68rem] lg:text-[0.72rem] lg:tracking-[0.2em]">
              <CircleDot aria-hidden="true" className="h-3 w-3 text-teal-300 sm:h-4 sm:w-4" />
              {row.label}
            </div>

            <div className="flex min-w-0 flex-wrap gap-1.5 sm:gap-2 lg:gap-2.5">
              {row.holeCards.map((card) => (
                <CardImage key={`${row.label}-${card.alt}`} card={card} />
              ))}
            </div>

            {row.discarded ? (
              <div className="col-start-2 lg:col-start-auto">
                <DiscardCard card={row.discarded} />
              </div>
            ) : (
              <div className="col-start-2 font-[var(--font-display)] text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-amber-200 sm:text-xs sm:tracking-[0.18em] lg:col-start-auto">
                {row.holeLabel}
              </div>
            )}
          </div>
        ))}

        <div className="text-center text-xs font-semibold leading-5 text-teal-200 sm:text-sm">
          Best 5-card hand from 2 hole cards + 5 board cards wins.
        </div>
      </div>
    </div>
  );
}

function DiscordLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      focusable="false"
    >
      <path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.2.4c-.2.4-.4.8-.5 1.2a18.4 18.4 0 0 0-5.4 0A9.7 9.7 0 0 0 8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 .1 13.4.5 17.7A19.8 19.8 0 0 0 6.5 21c.5-.6.9-1.3 1.2-2a12.9 12.9 0 0 1-1.9-.9l.5-.4a14.2 14.2 0 0 0 11.4 0l.5.4c-.6.4-1.2.7-1.9.9.4.7.8 1.4 1.2 2a19.8 19.8 0 0 0 6-3.3c.5-5-.8-9.4-3.2-13.3ZM8.2 15c-1.1 0-2-1-2-2.1s.9-2.1 2-2.1 2 1 2 2.1-.9 2.1-2 2.1Zm7.6 0c-1.1 0-2-1-2-2.1s.9-2.1 2-2.1 2 1 2 2.1-.9 2.1-2 2.1Z" />
    </svg>
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
          {isSubmitting ? 'Joining...' : 'Join email list'}
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
  const [earlyAccessOpen, setEarlyAccessOpen] = useState(false);

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
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-8 sm:py-5">
            <BondiPokerLogo href="/" variant="nav" className="max-w-[68vw]" />
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

        <div className="relative z-10 mx-auto grid max-w-[92rem] items-center gap-8 px-6 py-8 sm:px-8 sm:py-10 lg:min-h-[560px] lg:grid-cols-[0.86fr_1.14fr] lg:gap-8 xl:px-10">
          <div className="max-w-xl">
            <h1 className="font-[var(--font-serif)] text-4xl font-semibold leading-[0.96] text-white sm:text-5xl lg:text-[4.2rem] xl:text-[4.55rem]">
              A new kind of online Hold&apos;em.
            </h1>

            <p className="mt-6 max-w-lg text-base leading-7 text-zinc-300 sm:text-lg lg:text-xl lg:leading-8">
              Real-time multiplayer poker with a twist: start with 5 hole cards, discard one after
              the flop, turn, and river, and reach showdown with just 2 hole cards.
            </p>

            <div className="mt-6 max-w-xl lg:mt-7">
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    logClientEvent('landing_cta', {
                      cta: 'hero_join_discord',
                      destination: 'discord_invite',
                    });
                  }}
                  className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-md border border-teal-200/80 bg-teal-400/[0.58] px-7 py-4 text-base font-semibold text-white shadow-[0_0_28px_rgba(20,184,166,0.26)] transition hover:bg-teal-300/[0.66]"
                >
                  <DiscordLogo className="h-5 w-5" />
                  Join Discord
                  <ExternalLink aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void handlePlayNow();
                  }}
                  disabled={playNowLoading}
                  className="inline-flex min-h-14 items-center justify-center rounded-md border border-amber-300/70 bg-transparent px-7 py-4 font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.16em] text-amber-100 transition hover:border-teal-200 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-40"
                >
                  {playNowLoading ? 'Opening' : 'Quick Play'}
                </button>
              </div>

              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Find live games, coordinate test sessions, get updates, and report bugs in Discord.
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-100/85">
                Games are still early and may not always be active.
              </p>

              <button
                type="button"
                aria-expanded={earlyAccessOpen}
                aria-controls="early-access-form"
                onClick={() => {
                  setEarlyAccessOpen((current) => !current);
                  logClientEvent('landing_cta', {
                    cta: 'hero_join_email_list',
                    destination: '#early-access-form',
                  });
                }}
                className="mt-3 text-sm font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition hover:text-teal-100 hover:decoration-teal-300"
              >
                Prefer email updates?
              </button>
            </div>

            {earlyAccessOpen ? (
              <div id="early-access-form" className="mt-4 max-w-lg">
                <EarlyAccessForm />
              </div>
            ) : null}
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
            <BondiPokerLogo variant="nav" className="w-64 max-w-full sm:w-72" />
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
