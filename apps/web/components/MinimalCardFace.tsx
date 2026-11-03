import type { Card } from '@pdh/engine';
const MINIMAL_DECK_PALETTE = {
  face: '#f6f7f2',
  border: '#e2e8f0',
  navy: '#0b1d3a',
  orange: '#f15a29',
  accent: '#cbd5e1',
};
type Pip = { x: number; y: number; size?: number };

const pipLayoutByRank: Record<Card['rank'], Pip[]> = {
  A: [{ x: 50, y: 72, size: 28 }],
  K: [],
  Q: [],
  J: [],
  T: [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 52 },
    { x: 68, y: 52 },
    { x: 32, y: 70 },
    { x: 68, y: 70 },
    { x: 32, y: 88 },
    { x: 68, y: 88 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '9': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 52 },
    { x: 68, y: 52 },
    { x: 32, y: 88 },
    { x: 68, y: 88 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
    { x: 50, y: 70 },
  ],
  '8': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 52 },
    { x: 68, y: 52 },
    { x: 32, y: 88 },
    { x: 68, y: 88 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '7': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 70 },
    { x: 68, y: 70 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
    { x: 50, y: 52 },
  ],
  '6': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 70 },
    { x: 68, y: 70 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '5': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
    { x: 50, y: 70 },
  ],
  '4': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '3': [
    { x: 50, y: 34 },
    { x: 50, y: 70 },
    { x: 50, y: 106 },
  ],
  '2': [
    { x: 50, y: 34 },
    { x: 50, y: 106 },
  ],
};

const SuitPip = ({
  suit,
  x,
  y,
  size,
  color,
}: {
  suit: Card['suit'];
  x: number;
  y: number;
  size: number;
  color: string;
}) => {
  const scale = size / 100;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) translate(-50 -50)`} fill={color}>
      {suit === 'H' && (
        <path d="M50 90 L18 52 C6 36 14 16 34 16 C44 16 50 24 50 32 C50 24 56 16 66 16 C86 16 94 36 82 52 L50 90 Z" />
      )}
      {suit === 'S' && (
        <>
          <path d="M50 12 C70 32 90 50 50 88 C10 50 30 32 50 12 Z" />
          <path d="M45 88 L55 88 L62 100 L38 100 Z" />
        </>
      )}
      {suit === 'D' && <polygon points="50,8 88,50 50,92 12,50" />}
      {suit === 'C' && (
        <>
          <circle cx="35" cy="45" r="18" />
          <circle cx="65" cy="45" r="18" />
          <circle cx="50" cy="25" r="18" />
          <rect x="44" y="45" width="12" height="38" rx="4" />
        </>
      )}
    </g>
  );
};

// Shared with the existing live deck so practice teaches with the same readable cards.
export function MinimalCardFace({ card }: { card: Card }) {
  const rankLabel = card.rank === 'T' ? '10' : card.rank;
  const suit = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[card.suit];
  const suitColor =
    card.suit === 'H' || card.suit === 'D'
      ? MINIMAL_DECK_PALETTE.orange
      : MINIMAL_DECK_PALETTE.navy;
  const isFaceCard = ['J', 'Q', 'K'].includes(card.rank);
  const cornerFontSize = rankLabel === '10' ? 14 : 16;
  const cornerSuitSize = 14;
  const pipSize = 17;
  const pips = pipLayoutByRank[card.rank] ?? [];
  return (
    <svg
      viewBox="0 0 100 140"
      width="100%"
      height="100%"
      role="img"
      aria-label={`${rankLabel} of ${suit}`}
    >
      <rect x="0" y="0" width="100" height="140" rx="10" fill={MINIMAL_DECK_PALETTE.face} />
      <g
        fontFamily="var(--font-sans, Manrope, ui-sans-serif, system-ui)"
        fontWeight={700}
        fill={suitColor}
      >
        <text x="8" y="18" fontSize={cornerFontSize}>
          {rankLabel}
        </text>
      </g>
      <SuitPip suit={card.suit} x={13} y={30} size={cornerSuitSize} color={suitColor} />
      <g transform="translate(100 140) rotate(180)">
        <text
          x="8"
          y="18"
          fontSize={cornerFontSize}
          fontFamily="var(--font-sans, Manrope, ui-sans-serif, system-ui)"
          fontWeight={700}
          fill={suitColor}
        >
          {rankLabel}
        </text>
        <SuitPip suit={card.suit} x={13} y={30} size={cornerSuitSize} color={suitColor} />
      </g>
      {isFaceCard ? (
        <>
          <g opacity="0.55" fill={MINIMAL_DECK_PALETTE.accent}>
            <rect x="28" y="32" width="44" height="76" rx="12" transform="rotate(-18 50 70)" />
            <rect x="28" y="32" width="44" height="76" rx="12" transform="rotate(18 50 70)" />
          </g>
          <SuitPip suit={card.suit} x={50} y={70} size={26} color={suitColor} />
        </>
      ) : (
        <>
          {pips.map((pip, idx) => (
            <SuitPip
              key={idx}
              suit={card.suit}
              x={pip.x}
              y={pip.y}
              size={pip.size ?? pipSize}
              color={suitColor}
            />
          ))}
        </>
      )}
      <image
        href="/cards/coastal/surf.jpg"
        x="32"
        y="116"
        width="36"
        height="8"
        preserveAspectRatio="xMidYMid slice"
        opacity="0.35"
      />
    </svg>
  );
}
