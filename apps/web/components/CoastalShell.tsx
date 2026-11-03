import Link from 'next/link';
import { ArrowUpRight, Users } from 'lucide-react';
import type { ReactNode } from 'react';

export const DISCORD_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || 'https://discord.gg/tmkeanX7T';

export function CoastalHeader() {
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
        <a href="https://x.com/BondiPoker" target="_blank" rel="noopener noreferrer">
          X <span className="nav-label">Community</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" aria-label="Discord">
          <Users size={17} aria-hidden="true" />
          <span className="nav-community-label">Discord</span>
        </a>
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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`coastal-page ${className}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <CoastalHeader />
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
