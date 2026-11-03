import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import { CoastalFooter, CoastalShell, DISCORD_URL } from './CoastalShell';
import { CoastalCard } from './CoastalCard';
import { PRACTICE_HAND } from '../lib/practiceHand';
import EarlyAccessForm from './EarlyAccessForm';

export default function HeroSection() {
  return (
    <CoastalShell>
      <main id="main-content">
        <section className="coastal-hero" aria-labelledby="hero-heading">
          <div className="coastal-hero-copy">
            <p className="coastal-eyebrow">A little Bondi. A whole new hand.</p>
            <h1 id="hero-heading">
              Your table. Your people.
              <br />A fresh twist on poker.
            </h1>
            <p className="coastal-intro">
              Start with five cards. Discard after each post-flop betting round. Finish with two.
            </p>
            <div className="coastal-ctas">
              <Link className="coastal-button primary" href="/play?action=create">
                Create a free table <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="coastal-button secondary" href="/practice">
                Try a practice hand
              </Link>
            </div>
            <p className="coastal-fineprint">
              Free account for multiplayer. Play chips only. No cash value.
            </p>
            <Link className="coastal-inline-link" href="/play#join-table">
              Have a table code? Join your friends <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="hero-preview">
            <div className="coastal-table-preview">
              <span className="table-preview-label">Table preview</span>
              <div className="preview-hand">
                {PRACTICE_HAND.map((card) => (
                  <CoastalCard key={card.rank} card={card} />
                ))}
              </div>
              <p className="table-progression">
                5 cards <ArrowRight size={18} aria-hidden="true" /> 3 hidden discards{' '}
                <ArrowRight size={18} aria-hidden="true" /> 2 cards
              </p>
              <Link className="preview-invite" href="/play?action=create">
                <Users size={22} aria-hidden="true" />
                Invite friends
              </Link>
              <span className="your-seat">Your seat</span>
            </div>
            <p className="preview-caption">Make a table. Send the link. Bring your friends.</p>
          </div>
        </section>
        <section className="coastal-learn-strip" id="how-it-works" aria-labelledby="learn-heading">
          <div>
            <h2 id="learn-heading">New to Bondi Poker?</h2>
            <p>Learn the twist in a practice hand.</p>
          </div>
          <Link
            className="learn-progression"
            href="/practice"
            aria-label="Practise going from five cards to two"
          >
            <CoastalCard card={{ rank: '5', suit: 'S' }} />
            <ArrowRight aria-hidden="true" />
            <CoastalCard card={{ rank: '4', suit: 'H' }} />
            <ArrowRight aria-hidden="true" />
            <CoastalCard card={{ rank: '3', suit: 'C' }} />
            <ArrowRight aria-hidden="true" />
            <CoastalCard card={{ rank: '2', suit: 'D' }} />
          </Link>
          <a
            href={DISCORD_URL}
            className="coastal-community"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Users size={24} aria-hidden="true" />
            <span>
              Find your people
              <br />
              <b>
                Join the Discord community <ArrowRight size={15} aria-hidden="true" />
              </b>
            </span>
          </a>
        </section>
        <section className="coastal-rules" aria-label="How Bondi Poker works">
          {[
            [
              '01',
              'Start with five.',
              'A standard deck. Two to nine friends. Five private cards each.',
            ],
            [
              '02',
              'Choose what stays.',
              'Bet as in Hold’em. After flop, turn and river betting, discard one card. Your discards stay hidden.',
            ],
            [
              '03',
              'Finish with two.',
              'Make the best five-card hand using your two remaining cards and the five shared cards.',
            ],
          ].map(([step, title, copy]) => (
            <div key={step}>
              <span>{step}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          ))}
        </section>
        <details className="coastal-email">
          <summary>Get test-night invitations by email</summary>
          <EarlyAccessForm />
        </details>
      </main>
      <CoastalFooter />
    </CoastalShell>
  );
}
