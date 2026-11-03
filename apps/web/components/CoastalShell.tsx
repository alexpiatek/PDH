import Link from 'next/link';
import { ArrowUpRight, Users } from 'lucide-react';
import type { ReactNode } from 'react';

export const DISCORD_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || 'https://discord.gg/tmkeanX7T';

export function CoastalHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="coastal-header">
      <Link href="/" className="coastal-brand" aria-label="Bondi Poker home">
        <img src="/brand/bondi-poker-mark.svg" width="30" height="36" alt="" aria-hidden="true" />
        <span>
          BONDI <b>POKER</b>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#how-it-works" className="coastal-rules-link">
          How to play
        </Link>
        {compact ? (
          <Link href="/play#join-table">Join a table</Link>
        ) : (
          <>
            <a
              className="coastal-social-link"
              href="https://x.com/BondiPoker"
              target="_blank"
              rel="noopener noreferrer"
            >
              X <span className="nav-label">Community</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a
              className="coastal-social-link"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord"
            >
              <Users size={17} aria-hidden="true" />
              <span className="nav-community-label">Discord</span>
            </a>
          </>
        )}
        <Link href="/profile" className="coastal-signin">
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function CoastalShell({
  children,
  className = '',
  compactHeader = false,
}: {
  children: ReactNode;
  className?: string;
  compactHeader?: boolean;
}) {
  return (
    <div className={`coastal-page ${className}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <CoastalHeader compact={compactHeader} />
      {children}
    </div>
  );
}

export function CoastalFooter() {
  return (
    <footer className="coastal-footer">
      <span>Born by the coast. Made for your poker night.</span>
      <div>
        <a href="https://x.com/BondiPoker" target="_blank" rel="noopener noreferrer">
          X / @BondiPoker
        </a>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>
        <a href="mailto:admin@bondipoker.com">Get in touch</a>
      </div>
      <small>Free play chips. No purchases, cash value or withdrawals.</small>
    </footer>
  );
}
