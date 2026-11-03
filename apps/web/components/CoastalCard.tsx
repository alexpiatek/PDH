import type { Card } from '@pdh/engine';
import { MinimalCardFace } from './MinimalCardFace';
export function CoastalCard({ card, selected = false }: { card: Card; selected?: boolean }) {
  return (
    <span className={`coastal-card ${selected ? 'is-selected' : ''}`}>
      <MinimalCardFace card={card} />
    </span>
  );
}
