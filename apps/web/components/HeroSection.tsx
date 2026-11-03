import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CoastalFooter, CoastalShell } from './CoastalShell';
import { CoastalPhotoCard } from './CoastalCard';
import { PRACTICE_HAND } from '../lib/practiceHand';
import EarlyAccessForm from './EarlyAccessForm';

// Brad's original coastal photographs, in the original A–10 hand order.
const HERO_PHOTOS = ['coast', 'ocean', 'shore', 'surf', 'beach'] as const;

export default function HeroSection() {
  return (
    <CoastalShell className="coastal-home" compactHeader>
      <main id="main-content">
        <section className="coastal-hero" aria-labelledby="hero-heading">
          <div className="coastal-hero-copy">
            <p className="coastal-eyebrow">A fresh twist on Hold’em</p>
            <h1 id="hero-heading">
              Poker night.
              <br />
              With your people.
            </h1>
            <p className="coastal-intro">
              Start with five cards. Finish with two. Bring your friends and see what stays.
            </p>
            <div className="coastal-ctas">
              <Link className="coastal-button primary" href="/play?action=create">
                Play with friends <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="coastal-button secondary" href="/practice">
                Try a practice hand
              </Link>
            </div>
            <p className="coastal-fineprint">Free play chips. No cash value.</p>
          </div>
          <div className="hero-preview">
            <div className="coastal-table-preview">
              <div className="preview-hand">
                {PRACTICE_HAND.map((card, index) => (
                  <CoastalPhotoCard
                    key={card.rank}
                    card={card}
                    image={`/cards/coastal/${HERO_PHOTOS[index]}.jpg`}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="coastal-how" id="how-it-works" aria-labelledby="learn-heading">
          <div className="coastal-how-heading">
            <div>
              <h2 id="learn-heading">Five cards to two. Here’s the twist.</h2>
              <p>Hold’em betting. Three hidden discards.</p>
            </div>
            <Link className="coastal-practice-link" href="/practice">
              Try it in a practice hand <ArrowRight size={17} aria-hidden="true" />
              <small>No account needed</small>
            </Link>
          </div>
          <ol className="coastal-rules" aria-label="How Bondi Poker works">
            {[
              [
                '01',
                'Start with five.',
                'Two to nine friends. Five private cards each. The betting works like Hold’em.',
              ],
              [
                '02',
                'Choose what stays.',
                'After the flop, turn and river betting rounds, discard one card. Keep every discard hidden.',
              ],
              [
                '03',
                'Finish with two.',
                'Reach showdown with two cards. Make your best five-card hand with the five shared cards.',
              ],
            ].map(([step, title, copy]) => (
              <li key={step}>
                <span aria-hidden="true">{step}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </li>
            ))}
          </ol>
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
