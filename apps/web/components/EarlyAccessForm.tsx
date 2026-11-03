import { type FormEvent, useState } from 'react';
import { logClientEvent } from '../lib/clientTelemetry';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EARLY_ACCESS_SUCCESS_MESSAGE =
  'You’re on the list. We’ll send test-night announcements and launch updates.';
type EarlyAccessFormFields = {
  email: string;
  name: string;
  is18PlusConfirmed: boolean;
  marketingConsent: boolean;
};

type EarlyAccessFormErrors = Partial<Record<keyof EarlyAccessFormFields | 'form', string>>;

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

export default function EarlyAccessForm() {
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
