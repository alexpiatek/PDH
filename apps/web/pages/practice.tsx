import { useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowRight, Check, RotateCcw, ShieldCheck } from 'lucide-react';
import { evaluateSeven, HAND_CATEGORY_LABELS } from '@pdh/engine';
import { CoastalShell, CoastalFooter } from '../components/CoastalShell';
import { CoastalCard } from '../components/CoastalCard';
import { discardPracticeCard, PRACTICE_BOARD, PRACTICE_HAND } from '../lib/practiceHand';
import { logClientEvent } from '../lib/clientTelemetry';

const STREETS = ['Flop', 'Turn', 'River', 'Showdown'];
export default function PracticePage() {
  const [hand, setHand] = useState(PRACTICE_HAND);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const instruction = useRef<HTMLHeadingElement>(null);
  const complete = step === 3;
  const board = PRACTICE_BOARD.slice(0, Math.min(3 + step, 5));
  const result = complete ? evaluateSeven([...hand, ...board]) : null;
  const discard = () => {
    if (selected === null || complete) return;
    setHand(discardPracticeCard(hand, selected));
    setSelected(null);
    setStep(step + 1);
    logClientEvent('practice_discard', { street: STREETS[step].toLowerCase() });
    if (step === 2) logClientEvent('practice_complete');
    instruction.current?.focus();
  };
  return (
    <CoastalShell className="practice-page">
      <Head>
        <title>Try a practice hand | Bondi Poker</title>
        <meta
          name="description"
          content="Learn Bondi Poker’s three hidden discards in a guided practice hand. No account needed."
        />
      </Head>
      <main id="main-content" className="practice-main">
        <div className="practice-heading">
          <p className="coastal-eyebrow">Guided practice · No account needed</p>
          <h1>What would you let go?</h1>
          <p>Five cards. Three hidden discards. A fresh twist on Hold’em.</p>
        </div>
        <div className="practice-progress" aria-label="Hand progress">
          {STREETS.map((street, i) => (
            <div
              key={street}
              className={step === i ? 'active' : step > i ? 'done' : ''}
              aria-current={step === i ? 'step' : undefined}
            >
              {step > i ? <Check size={16} aria-hidden="true" /> : <span>{i + 1}</span>}
              <b>{street}</b>
              <small>{i === 3 ? '2 cards left' : `${5 - i} cards`}</small>
            </div>
          ))}
        </div>
        <section className="practice-table" aria-label="Practice poker table">
          <p className="practice-label">Shared cards</p>
          <div className="practice-board">
            {board.map((card) => (
              <CoastalCard key={card.rank} card={card} />
            ))}
          </div>
          <div className="practice-instruction" aria-live="polite">
            <h2 ref={instruction} tabIndex={-1}>
              {complete
                ? `Your hand: ${HAND_CATEGORY_LABELS[result!.category]}`
                : `${STREETS[step]} betting is finished. Choose one card to discard.`}
            </h2>
            <p>
              {complete
                ? 'The best five cards from your two remaining cards and the board make your hand.'
                : 'This guided hand skips the betting. In a live game, bet first, then discard.'}
            </p>
          </div>
          <p className="practice-label">Your hand · {hand.length} cards</p>
          <div className="practice-hand">
            {hand.map((card, i) => (
              <button
                key={`${card.rank}${card.suit}`}
                type="button"
                aria-label={`Select ${card.rank === 'T' ? '10' : card.rank} of ${{ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[card.suit]} to discard`}
                aria-pressed={selected === i}
                disabled={complete}
                onClick={() => setSelected(i)}
              >
                <CoastalCard card={card} selected={selected === i} />
                {selected === i && <span className="card-selected-label">Selected</span>}
              </button>
            ))}
          </div>
          {complete ? (
            <>
              <p className="practice-best-label">Your best five</p>
              <div className="practice-best">
                {result!.bestFive.map((card) => (
                  <CoastalCard key={`${card.rank}${card.suit}`} card={card} />
                ))}
              </div>
              <p className="practice-result-note">
                Practice complete. Try different discards to see how your final hand changes.
              </p>
              <div className="coastal-ctas">
                <Link href="/play?action=create" className="coastal-button primary">
                  Create a table for friends <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <button
                  className="coastal-button secondary"
                  onClick={() => {
                    setHand(PRACTICE_HAND);
                    setStep(0);
                    setSelected(null);
                    instruction.current?.focus();
                  }}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  Try different discards
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="coastal-button primary practice-discard"
                disabled={selected === null}
                onClick={discard}
              >
                Discard{' '}
                {selected !== null
                  ? hand[selected].rank === 'T'
                    ? '10'
                    : hand[selected].rank
                  : 'one card'}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <p className="practice-hint">
                <ShieldCheck size={15} aria-hidden="true" /> Your discard stays hidden.
              </p>
            </>
          )}
        </section>
        <p className="practice-bottom">
          Local practice only. No chips are added to or taken from your account.{' '}
          <Link href="/play?action=create">Ready for a poker night?</Link>
        </p>
      </main>
      <CoastalFooter />
    </CoastalShell>
  );
}
