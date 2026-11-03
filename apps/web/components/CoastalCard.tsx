import type { Card } from '@pdh/engine';
import { MinimalCardFace } from './MinimalCardFace';
export function CoastalCard({ card, selected = false }: { card: Card; selected?: boolean }) {
  return (
    <span className={`coastal-card ${selected ? 'is-selected' : ''}`}>
      <MinimalCardFace card={card} />
    </span>
  );
}

// Preserve Brad's photo-card composition on the homepage. Practice and live play
// retain MinimalCardFace so their pips, selection and scoring remain familiar.
export function CoastalPhotoCard({ card, image }: { card: Card; image: string }) {
  const rank = card.rank === 'T' ? '10' : card.rank;
  const suit = { S: '♠', H: '♥', D: '♦', C: '♣' }[card.suit];
  const suitName = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[card.suit];
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <span
      className={`coastal-card coastal-photo-card ${red ? 'is-red' : ''}`}
      role="img"
      aria-label={`${rank} of ${suitName}`}
    >
      <img src={image} alt="" className="coastal-photo" />
      <span className="photo-card-corner" aria-hidden="true">
        {rank}
        <span>{suit}</span>
      </span>
      <span className="photo-card-corner opposite" aria-hidden="true">
        {rank}
        <span>{suit}</span>
      </span>
      <span className="photo-card-brand" aria-hidden="true">
        BONDI POKER
      </span>
      <span className="photo-card-brand opposite" aria-hidden="true">
        BONDI POKER
      </span>
    </span>
  );
}
