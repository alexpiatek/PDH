type BondiPokerLogoVariant = 'lockup' | 'nav' | 'table';

type BondiPokerLogoProps = {
  variant: BondiPokerLogoVariant;
  className?: string;
  href?: string;
};

const STACKED_LOGO_SRC = '/brand/bondi-poker-logo.svg';
const MARK_LOGO_SRC = '/brand/bondi-poker-mark.svg';
const WORDMARK_LOGO_SRC = '/brand/bondi-poker-wordmark.svg';
const LOGO_ALT = 'Bondi Poker';

export function BondiPokerLogo({ variant, className = '', href }: BondiPokerLogoProps) {
  const content = (() => {
    if (variant === 'lockup') {
      return (
        <img
          src={STACKED_LOGO_SRC}
          alt={LOGO_ALT}
          className="block aspect-square w-full rounded-lg border border-amber-200/25 object-cover shadow-[0_22px_60px_rgba(0,0,0,0.3)]"
        />
      );
    }

    if (variant === 'nav') {
      return (
        <img
          src={WORDMARK_LOGO_SRC}
          alt={LOGO_ALT}
          className="block h-auto w-full object-contain"
        />
      );
    }

    return (
      <>
        <img
          src={MARK_LOGO_SRC}
          alt={LOGO_ALT}
          className="h-7 w-7 shrink-0 rounded border border-amber-200/30 object-cover shadow-[0_8px_18px_rgba(0,0,0,0.28)]"
        />
        <span className="truncate font-[var(--font-display)] text-[0.68rem] font-bold uppercase tracking-[0.18em] text-amber-200">
          Bondi Poker
        </span>
      </>
    );
  })();

  const baseClass =
    variant === 'lockup'
      ? `inline-block w-24 sm:w-28 ${className}`
      : variant === 'nav'
        ? `inline-block w-48 sm:w-56 lg:w-64 ${className}`
        : `inline-flex min-w-0 items-center gap-2.5 ${className}`;

  if (href) {
    return (
      <a href={href} className={baseClass} aria-label="Bondi Poker">
        {content}
      </a>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
