const rounds = [
  { street: 'preflop', label: 'Start', cards: 5 },
  { street: 'flop', label: 'After flop', cards: 4 },
  { street: 'turn', label: 'After turn', cards: 3 },
  { street: 'river', label: 'Finish', cards: 2 },
];

/** Counts are the cards kept after each round, rather than a live hole-card count. */
export function HandProgress({
  street,
  compact = false,
  onShowRules,
}: {
  street?: string;
  compact?: boolean;
  onShowRules?: () => void;
}) {
  const current = street === 'showdown' ? 'river' : street;
  const content = rounds.map((round, index) => (
    <span
      key={round.street}
      className={`hand-progress-step ${current === round.street ? 'current' : ''}`}
      aria-current={current === round.street ? 'step' : undefined}
    >
      {index > 0 && (
        <span className="hand-progress-arrow" aria-hidden="true">
          →
        </span>
      )}
      <b>{round.cards}</b>
      {!compact && <span>{round.label}</span>}
    </span>
  ));
  const label =
    'Cards to keep: start with five, four after the flop, three after the turn, finish with two.';
  return onShowRules ? (
    <button
      type="button"
      className={`hand-progress ${compact ? 'compact' : ''}`}
      onClick={onShowRules}
      aria-label={`${label} Open game rules.`}
      aria-haspopup="dialog"
      data-testid="hand-progress"
    >
      {content}
    </button>
  ) : (
    <div className="hand-progress" aria-label={label}>
      {content}
    </div>
  );
}
