import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { useState } from 'react';
import PokerGamePage from '../../components/PokerGamePage';
import type { PublicState } from '../../server-types';

type Scenario =
  | 'betting-call'
  | 'betting-check-allin'
  | 'discard'
  | 'all-in-discard-transition'
  | 'all-in-discard-stale-seat'
  | 'showdown'
  | 'showdown-long'
  | 'long-names'
  | 'mobile-4'
  | 'mobile-5'
  | 'mobile-6'
  | 'mobile-9'
  | 'out-of-chips-active'
  | 'out-of-chips-between'
  | 'start-gate'
  | 'start-gate-ready'
  | 'join-fallback'
  | 'joining-known-name';

interface TestPageProps {
  scenario: Scenario;
  state: PublicState | null;
  playerId: string | null;
  debugStatus: string;
}

const HERO_ID = 'player-hero';
const VILLAIN_ID = 'player-villain';

const scenarios = new Set<Scenario>([
  'betting-call',
  'betting-check-allin',
  'discard',
  'all-in-discard-transition',
  'all-in-discard-stale-seat',
  'showdown',
  'showdown-long',
  'long-names',
  'mobile-4',
  'mobile-5',
  'mobile-6',
  'mobile-9',
  'out-of-chips-active',
  'out-of-chips-between',
  'start-gate',
  'start-gate-ready',
  'join-fallback',
  'joining-known-name',
]);

const card = (rank: string, suit: string) => ({ rank, suit });

const heroCards = [card('A', 'S'), card('K', 'D'), card('Q', 'H'), card('J', 'C'), card('9', 'S')];

const hiddenCards = [
  card('X', 'X'),
  card('X', 'X'),
  card('X', 'X'),
  card('X', 'X'),
  card('X', 'X'),
];

const baseSeats = (heroStack: number) => [
  {
    seat: 0,
    id: HERO_ID,
    name: 'Alex',
    stack: heroStack,
    status: 'active',
    sittingOut: false,
    buyInTotal: 10000,
    rebuyCount: 0,
    connectionStatus: 'connected',
  },
  {
    seat: 1,
    id: VILLAIN_ID,
    name: 'Sam',
    stack: 8200,
    status: 'active',
    sittingOut: false,
    buyInTotal: 10000,
    rebuyCount: 0,
    connectionStatus: 'connected',
  },
];

const basePlayers = ({
  heroStack,
  heroBet = 0,
  villainStack = 8200,
  villainBet = 0,
}: {
  heroStack: number;
  heroBet?: number;
  villainStack?: number;
  villainBet?: number;
}) => [
  {
    seat: 0,
    id: HERO_ID,
    name: 'Alex',
    stack: heroStack,
    status: 'active',
    holeCards: heroCards,
    betThisStreet: heroBet,
    totalCommitted: heroBet,
    hasActed: false,
  },
  {
    seat: 1,
    id: VILLAIN_ID,
    name: 'Sam',
    stack: villainStack,
    status: 'active',
    holeCards: hiddenCards,
    betThisStreet: villainBet,
    totalCommitted: villainBet,
    hasActed: true,
  },
];

const baseState = (scenario: Scenario, now: number, state: Partial<PublicState>): PublicState => ({
  id: `tray-${scenario}`,
  seats: baseSeats(7600),
  buttonSeat: 0,
  startGate: null,
  hand: null,
  log: [],
  connections: {
    [HERO_ID]: { status: 'connected', graceDeadlineMs: null, lastSeenMs: now },
    [VILLAIN_ID]: { status: 'connected', graceDeadlineMs: null, lastSeenMs: now },
  },
  stateVersion: 1,
  serverTimeMs: now,
  betweenHandStartedAtMs: null,
  betweenHandMinUntilMs: null,
  betweenHandAutoStartAtMs: null,
  readyForNextHandPlayerIds: [],
  legalActions: { phase: 'waiting', isActor: false, reason: 'waiting_for_players' },
  you: { playerId: HERO_ID },
  ...state,
});

const bettingCallState = (now: number): PublicState =>
  baseState('betting-call', now, {
    hand: {
      handId: 'hand-betting-call',
      buttonSeat: 0,
      street: 'preflop',
      phase: 'betting',
      board: [],
      deck: [],
      players: basePlayers({ heroStack: 7600, heroBet: 400, villainBet: 800 }),
      pots: [],
      currentBet: 800,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: 0,
      actionDeadline: now + 25000,
      lastAggressorSeat: 1,
      pendingNextPhaseAt: null,
      discardPending: [],
      discardDeadline: null,
      showdownWinners: [],
      showdownPots: [],
      log: [
        { message: 'Hand started', ts: now - 6000 },
        { message: 'Sam raised to 800', ts: now - 3000 },
      ],
    },
    log: [
      { message: 'Hand started', ts: now - 6000 },
      { message: 'Sam raised to 800', ts: now - 3000 },
    ],
    legalActions: {
      phase: 'betting',
      isActor: true,
      betting: {
        canFold: true,
        canCheck: false,
        canCall: true,
        callAmount: 400,
        canBet: false,
        minBet: null,
        maxBet: null,
        canRaise: true,
        minRaiseTo: 1600,
        maxRaiseTo: 8000,
        canAllIn: true,
        allInAmount: 8000,
        stack: 7600,
        committedThisStreet: 400,
        currentBet: 800,
      },
    },
  });

const bettingCheckAllInState = (now: number): PublicState =>
  baseState('betting-check-allin', now, {
    seats: baseSeats(300),
    hand: {
      handId: 'hand-betting-check-allin',
      buttonSeat: 0,
      street: 'flop',
      phase: 'betting',
      board: [card('2', 'S'), card('7', 'D'), card('T', 'H')],
      deck: [],
      players: basePlayers({ heroStack: 300, heroBet: 0, villainBet: 0 }),
      pots: [],
      currentBet: 0,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: 0,
      actionDeadline: now + 25000,
      lastAggressorSeat: null,
      pendingNextPhaseAt: null,
      discardPending: [],
      discardDeadline: null,
      showdownWinners: [],
      showdownPots: [],
      log: [
        { message: 'Starting betting on flop', ts: now - 4000 },
        { message: 'Sam checked', ts: now - 3000 },
      ],
    },
    log: [
      { message: 'Starting betting on flop', ts: now - 4000 },
      { message: 'Sam checked', ts: now - 3000 },
    ],
    legalActions: {
      phase: 'betting',
      isActor: true,
      betting: {
        canFold: true,
        canCheck: true,
        canCall: false,
        callAmount: 0,
        canBet: false,
        minBet: 800,
        maxBet: 300,
        canRaise: false,
        minRaiseTo: null,
        maxRaiseTo: null,
        canAllIn: true,
        allInAmount: 300,
        stack: 300,
        committedThisStreet: 0,
        currentBet: 0,
      },
    },
  });

const discardState = (now: number): PublicState =>
  baseState('discard', now, {
    hand: {
      handId: 'hand-discard',
      buttonSeat: 0,
      street: 'flop',
      phase: 'discard',
      board: [card('2', 'S'), card('7', 'D'), card('T', 'H')],
      deck: [],
      players: basePlayers({ heroStack: 7600, villainStack: 8200 }),
      pots: [],
      currentBet: 0,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: -1,
      actionDeadline: null,
      lastAggressorSeat: null,
      pendingNextPhaseAt: null,
      discardPending: [HERO_ID],
      discardDeadline: now + 25000,
      showdownWinners: [],
      showdownPots: [],
      log: [{ message: 'Discard phase started on flop', ts: now - 3000 }],
    },
    log: [{ message: 'Discard phase started on flop', ts: now - 3000 }],
    legalActions: {
      phase: 'discard',
      isActor: true,
      discard: {
        required: true,
        count: 1,
        validIndexes: [0, 1, 2, 3, 4],
        deadlineMs: now + 25000,
      },
    },
  });

const allInDiscardStaleSeatState = (now: number): PublicState =>
  baseState('all-in-discard-stale-seat', now, {
    id: 'LIVE0',
    seats: [
      {
        seat: 0,
        id: HERO_ID,
        name: 'Alex',
        stack: 0,
        status: 'busted',
        sittingOut: true,
        buyInTotal: 10000,
        rebuyCount: 0,
        connectionStatus: 'connected',
      },
      {
        seat: 1,
        id: VILLAIN_ID,
        name: 'Sam',
        stack: 9200,
        status: 'active',
        sittingOut: false,
        buyInTotal: 10000,
        rebuyCount: 0,
        connectionStatus: 'connected',
      },
    ],
    hand: {
      handId: 'hand-all-in-discard',
      buttonSeat: 1,
      street: 'river',
      phase: 'discard',
      board: [card('2', 'S'), card('7', 'D'), card('T', 'H'), card('4', 'C'), card('9', 'S')],
      deck: [],
      players: [
        {
          seat: 0,
          id: HERO_ID,
          name: 'Alex',
          stack: 0,
          status: 'allIn',
          holeCards: [card('A', 'S'), card('K', 'D'), card('Q', 'H')],
          betThisStreet: 0,
          totalCommitted: 10000,
          hasActed: true,
        },
        {
          seat: 1,
          id: VILLAIN_ID,
          name: 'Sam',
          stack: 9200,
          status: 'allIn',
          holeCards: hiddenCards.slice(0, 3),
          betThisStreet: 0,
          totalCommitted: 10000,
          hasActed: true,
        },
      ],
      pots: [],
      currentBet: 0,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: -1,
      actionDeadline: null,
      lastAggressorSeat: null,
      pendingNextPhaseAt: null,
      discardPending: [HERO_ID],
      discardDeadline: now + 25000,
      showdownWinners: [],
      showdownPots: [],
      log: [
        { message: 'Sam all-in to 10000', ts: now - 9000 },
        { message: 'Discard phase started on river', ts: now - 3000 },
      ],
    },
    log: [
      { message: 'Sam all-in to 10000', ts: now - 9000 },
      { message: 'Discard phase started on river', ts: now - 3000 },
    ],
    legalActions: {
      phase: 'discard',
      isActor: true,
      discard: {
        required: true,
        count: 1,
        validIndexes: [0, 1, 2],
        deadlineMs: now + 25000,
      },
    },
  });

const allInDiscardTransitionState = (
  now: number,
  street: 'flop' | 'turn' | 'river',
  heroHoleCardsLength: number,
  stateVersion: number
): PublicState => {
  const board =
    street === 'flop'
      ? [card('2', 'S'), card('7', 'D'), card('T', 'H')]
      : street === 'turn'
        ? [card('2', 'S'), card('7', 'D'), card('T', 'H'), card('4', 'C')]
        : [card('2', 'S'), card('7', 'D'), card('T', 'H'), card('4', 'C'), card('9', 'S')];
  return baseState('all-in-discard-transition', now, {
    id: 'LIVE1',
    stateVersion,
    seats: [
      {
        seat: 0,
        id: HERO_ID,
        name: 'Alex',
        stack: 0,
        status: 'active',
        sittingOut: false,
        buyInTotal: 10000,
        rebuyCount: 0,
        connectionStatus: 'connected',
      },
      {
        seat: 1,
        id: VILLAIN_ID,
        name: 'Sam',
        stack: 0,
        status: 'active',
        sittingOut: false,
        buyInTotal: 10000,
        rebuyCount: 0,
        connectionStatus: 'connected',
      },
    ],
    hand: {
      handId: 'hand-all-in-transition',
      buttonSeat: 1,
      street,
      phase: 'discard',
      board,
      deck: [],
      players: [
        {
          seat: 0,
          id: HERO_ID,
          name: 'Alex',
          stack: 0,
          status: 'allIn',
          holeCards: heroCards.slice(0, heroHoleCardsLength),
          betThisStreet: 0,
          totalCommitted: 10000,
          hasActed: true,
        },
        {
          seat: 1,
          id: VILLAIN_ID,
          name: 'Sam',
          stack: 0,
          status: 'allIn',
          holeCards: hiddenCards.slice(0, heroHoleCardsLength),
          betThisStreet: 0,
          totalCommitted: 10000,
          hasActed: true,
        },
      ],
      pots: [],
      currentBet: 0,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: -1,
      actionDeadline: null,
      lastAggressorSeat: null,
      pendingNextPhaseAt: null,
      discardPending: [HERO_ID],
      discardDeadline: now + 25000,
      showdownWinners: [],
      showdownPots: [],
      log: [
        { message: 'All players are all-in', ts: now - 9000 },
        { message: `Discard phase started on ${street}`, ts: now - 3000 },
      ],
    },
    log: [
      { message: 'All players are all-in', ts: now - 9000 },
      { message: `Discard phase started on ${street}`, ts: now - 3000 },
    ],
    legalActions: {
      phase: 'discard',
      isActor: true,
      discard: {
        required: true,
        count: 1,
        validIndexes: Array.from({ length: heroHoleCardsLength }, (_, index) => index),
        deadlineMs: now + 25000,
      },
    },
  });
};

const showdownState = (now: number): PublicState =>
  baseState('showdown', now, {
    hand: {
      handId: 'hand-showdown',
      buttonSeat: 0,
      street: 'showdown',
      phase: 'showdown',
      board: [card('A', 'H'), card('K', 'H'), card('Q', 'H'), card('4', 'D'), card('2', 'C')],
      deck: [],
      players: [
        {
          seat: 0,
          id: HERO_ID,
          name: 'Alex',
          stack: 11600,
          status: 'active',
          holeCards: [card('J', 'H'), card('T', 'H')],
          betThisStreet: 0,
          totalCommitted: 2000,
          hasActed: true,
        },
        {
          seat: 1,
          id: VILLAIN_ID,
          name: 'Sam',
          stack: 6400,
          status: 'active',
          holeCards: [card('9', 'S'), card('9', 'D')],
          betThisStreet: 0,
          totalCommitted: 2000,
          hasActed: true,
        },
      ],
      pots: [],
      currentBet: 0,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: -1,
      actionDeadline: null,
      lastAggressorSeat: null,
      pendingNextPhaseAt: null,
      discardPending: [],
      discardDeadline: null,
      showdownWinners: [
        {
          playerId: HERO_ID,
          amount: 4000,
          bestFive: [
            card('A', 'H'),
            card('K', 'H'),
            card('Q', 'H'),
            card('J', 'H'),
            card('T', 'H'),
          ],
          handLabel: 'Straight Flush',
          potIds: ['pot-0'],
          potLabels: ['Main pot'],
        },
      ],
      showdownPots: [
        {
          potId: 'pot-0',
          label: 'Main pot',
          amount: 4000,
          eligible: [HERO_ID, VILLAIN_ID],
          winners: [
            {
              playerId: HERO_ID,
              amount: 4000,
              bestFive: [
                card('A', 'H'),
                card('K', 'H'),
                card('Q', 'H'),
                card('J', 'H'),
                card('T', 'H'),
              ],
              handLabel: 'Straight Flush',
            },
          ],
        },
      ],
      showdownRevealIds: [HERO_ID, VILLAIN_ID],
      log: [
        { message: 'Alex called 800', ts: now - 9000 },
        { message: 'Sam checked', ts: now - 6000 },
        { message: 'Alex wins 4000 with straight flush', ts: now - 2000 },
      ],
    },
    seats: [
      { ...baseSeats(11600)[0], stack: 11600 },
      { ...baseSeats(6400)[1], stack: 6400 },
    ],
    log: [
      { message: 'Alex called 800', ts: now - 9000 },
      { message: 'Sam checked', ts: now - 6000 },
      { message: 'Alex wins 4000 with straight flush', ts: now - 2000 },
    ],
    betweenHandStartedAtMs: now,
    betweenHandMinUntilMs: now + 6000,
    betweenHandAutoStartAtMs: now + 12000,
    readyForNextHandPlayerIds: [],
    legalActions: { phase: 'between_hands', isActor: false, reason: 'between_hands' },
  });

const longNamesState = (now: number): PublicState => {
  const state = bettingCallState(now);
  const heroName = 'Alex Chrome Long Table Name';
  const villainName = 'Samantha Big Blind Long Name';
  state.seats = state.seats.map((seat) =>
    seat.id === HERO_ID
      ? { ...seat, name: heroName }
      : seat.id === VILLAIN_ID
        ? { ...seat, name: villainName }
        : seat
  );
  if (state.hand) {
    state.hand.players = state.hand.players.map((player: any) =>
      player.id === HERO_ID
        ? { ...player, name: heroName }
        : player.id === VILLAIN_ID
          ? { ...player, name: villainName }
          : player
    );
    state.hand.log = [
      { message: `${villainName} posts big blind 800`, ts: now - 5000 },
      { message: `${heroName} called 400`, ts: now - 3000 },
    ];
  }
  state.log = state.hand?.log ?? state.log;
  return state;
};

const multiPlayerState = (now: number, count: 4 | 5 | 6 | 9): PublicState => {
  const names = [
    'Alex Chrome Long Table Name',
    'Brad Mobile Very Long Name',
    'Casey Small Blind Long Name',
    'Devon Dealer Long Name',
    'Emerson Cutoff Long Name',
    'Finley Big Blind Long Name',
    'Gray Button Long Name',
    'Harper Cutoff Long Name',
    'Indigo Under Gun Long Name',
  ];
  const seats = Array.from({ length: count }, (_, index) => ({
    seat: index,
    id: index === 0 ? HERO_ID : `player-${index + 1}`,
    name: names[index],
    stack: 10000 - index * 650,
    status: 'active',
    sittingOut: false,
    buyInTotal: 10000,
    rebuyCount: 0,
    connectionStatus: 'connected',
  }));
  const players = seats.map((seat, index) => ({
    seat: seat.seat,
    id: seat.id,
    name: seat.name,
    stack: seat.stack,
    status: 'active',
    holeCards: index === 0 ? heroCards : hiddenCards,
    betThisStreet: index === 1 ? 800 : index === 0 ? 400 : 0,
    totalCommitted: index === 1 ? 800 : index === 0 ? 400 : 0,
    hasActed: index !== 0,
  }));

  return baseState(`mobile-${count}` as Scenario, now, {
    seats,
    hand: {
      handId: `hand-mobile-${count}`,
      buttonSeat: 3 % count,
      street: 'preflop',
      phase: 'betting',
      board: [],
      deck: [],
      players,
      pots: [],
      currentBet: 800,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: 0,
      actionDeadline: now + 28000,
      lastAggressorSeat: 1,
      pendingNextPhaseAt: null,
      discardPending: [],
      discardDeadline: null,
      showdownWinners: [],
      showdownPots: [],
      log: [
        { message: `${names[1]} posts big blind 800`, ts: now - 5000 },
        { message: `${names[0]} called 400`, ts: now - 2500 },
      ],
    },
    log: [
      { message: `${names[1]} posts big blind 800`, ts: now - 5000 },
      { message: `${names[0]} called 400`, ts: now - 2500 },
    ],
    legalActions: {
      phase: 'betting',
      isActor: true,
      betting: {
        canFold: true,
        canCheck: false,
        canCall: true,
        callAmount: 400,
        canBet: false,
        minBet: null,
        maxBet: null,
        canRaise: true,
        minRaiseTo: 1600,
        maxRaiseTo: 10000,
        canAllIn: true,
        allInAmount: 10000,
        stack: 9600,
        committedThisStreet: 400,
        currentBet: 800,
      },
    },
  });
};

const showdownLongState = (now: number): PublicState => {
  const state = showdownState(now);
  const winnerName = 'Alex Mobile Long Winner Name';
  if (state.seats[0]) {
    state.seats[0] = { ...state.seats[0], name: winnerName, stack: 15675 };
  }
  if (state.hand) {
    state.hand.players = state.hand.players.map((player: any) =>
      player.id === HERO_ID ? { ...player, name: winnerName, stack: 15675 } : player
    );
    state.hand.showdownWinners = [
      {
        playerId: HERO_ID,
        amount: 16750,
        bestFive: [card('A', 'H'), card('K', 'H'), card('Q', 'H'), card('J', 'H'), card('T', 'H')],
        handLabel: 'Straight Flush',
        potIds: ['pot-0', 'pot-1'],
        potLabels: ['Main pot', 'Side pot 1'],
      },
    ];
    state.hand.showdownPots = [
      {
        potId: 'pot-0',
        label: 'Main pot',
        amount: 12000,
        eligible: [HERO_ID, VILLAIN_ID],
        winners: [{ playerId: HERO_ID, amount: 12000, handLabel: 'Straight Flush' }],
      },
      {
        potId: 'pot-1',
        label: 'Side pot 1',
        amount: 4750,
        eligible: [HERO_ID],
        winners: [{ playerId: HERO_ID, amount: 4750, handLabel: 'Straight Flush' }],
      },
    ];
    state.hand.log = [{ message: `${winnerName} wins 16750 with straight flush`, ts: now - 2000 }];
  }
  state.log = state.hand?.log ?? state.log;
  return state;
};

const outOfChipsState = (now: number, betweenHand: boolean): PublicState =>
  baseState(betweenHand ? 'out-of-chips-between' : 'out-of-chips-active', now, {
    id: 'QUEUE1',
    seats: [
      {
        seat: 0,
        id: HERO_ID,
        name: 'Alex Mobile',
        stack: 0,
        status: 'busted',
        sittingOut: true,
        buyInTotal: 10000,
        rebuyCount: 0,
        connectionStatus: 'connected',
      },
      {
        seat: 1,
        id: VILLAIN_ID,
        name: 'Brad Mobile',
        stack: 18600,
        status: 'active',
        sittingOut: false,
        buyInTotal: 10000,
        rebuyCount: 0,
        connectionStatus: 'connected',
      },
    ],
    hand: {
      handId: betweenHand ? 'hand-out-between' : 'hand-out-active',
      buttonSeat: 1,
      street: betweenHand ? 'showdown' : 'turn',
      phase: betweenHand ? 'showdown' : 'betting',
      board: [card('2', 'S'), card('7', 'D'), card('T', 'H'), card('4', 'C')],
      deck: [],
      players: [
        {
          seat: 1,
          id: VILLAIN_ID,
          name: 'Brad Mobile',
          stack: 18600,
          status: 'active',
          holeCards: hiddenCards,
          betThisStreet: 0,
          totalCommitted: 1400,
          hasActed: true,
        },
      ],
      pots: [],
      currentBet: 0,
      minRaise: 800,
      raisesThisStreet: 0,
      actionOnSeat: 1,
      actionDeadline: betweenHand ? null : now + 25000,
      lastAggressorSeat: null,
      pendingNextPhaseAt: null,
      discardPending: [],
      discardDeadline: null,
      showdownWinners: betweenHand
        ? [{ playerId: VILLAIN_ID, amount: 2800, handLabel: 'One Pair' }]
        : [],
      showdownPots: betweenHand
        ? [
            {
              potId: 'pot-0',
              label: 'Main pot',
              amount: 2800,
              eligible: [VILLAIN_ID],
              winners: [{ playerId: VILLAIN_ID, amount: 2800, handLabel: 'One Pair' }],
            },
          ]
        : [],
      log: [
        { message: 'Alex Mobile is out of chips', ts: now - 3000 },
        {
          message: betweenHand ? 'Brad Mobile wins 2800 with one pair' : 'Brad Mobile checked',
          ts: now - 1500,
        },
      ],
    },
    log: [
      { message: 'Alex Mobile is out of chips', ts: now - 3000 },
      {
        message: betweenHand ? 'Brad Mobile wins 2800 with one pair' : 'Brad Mobile checked',
        ts: now - 1500,
      },
    ],
    betweenHandStartedAtMs: betweenHand ? now : null,
    betweenHandMinUntilMs: betweenHand ? now + 6000 : null,
    betweenHandAutoStartAtMs: betweenHand ? now + 12000 : null,
    legalActions: {
      phase: betweenHand ? 'between_hands' : 'waiting',
      isActor: false,
      reason: betweenHand ? 'between_hands' : 'busted',
    },
  });

const startGateState = (now: number, readyPlayerIds: string[] = []): PublicState =>
  baseState('start-gate', now, {
    id: 'RZ587G',
    startGate: {
      openedAt: now - 4000,
      startsAt: now + 26000,
      earlyStartAt: now + 1000,
      minPlayers: 2,
      readyPlayerIds,
    },
    legalActions: { phase: 'waiting', isActor: false, reason: 'waiting_for_players' },
  });

const buildState = (scenario: Scenario, now: number): PublicState | null => {
  switch (scenario) {
    case 'join-fallback':
    case 'joining-known-name':
      return null;
    case 'start-gate-ready':
      return startGateState(now, [HERO_ID]);
    case 'start-gate':
      return startGateState(now);
    case 'betting-check-allin':
      return bettingCheckAllInState(now);
    case 'discard':
      return discardState(now);
    case 'all-in-discard-transition':
      return allInDiscardTransitionState(now, 'flop', 5, 1);
    case 'all-in-discard-stale-seat':
      return allInDiscardStaleSeatState(now);
    case 'showdown-long':
      return showdownLongState(now);
    case 'showdown':
      return showdownState(now);
    case 'long-names':
      return longNamesState(now);
    case 'mobile-4':
      return multiPlayerState(now, 4);
    case 'mobile-5':
      return multiPlayerState(now, 5);
    case 'mobile-6':
      return multiPlayerState(now, 6);
    case 'mobile-9':
      return multiPlayerState(now, 9);
    case 'out-of-chips-active':
      return outOfChipsState(now, false);
    case 'out-of-chips-between':
      return outOfChipsState(now, true);
    case 'betting-call':
    default:
      return bettingCallState(now);
  }
};

export const getServerSideProps: GetServerSideProps<TestPageProps> = async ({ query }) => {
  if (process.env.PDH_ENABLE_TEST_POKER_STATE !== '1') {
    return { notFound: true };
  }

  const rawScenario = Array.isArray(query.scenario) ? query.scenario[0] : query.scenario;
  const scenario = scenarios.has(rawScenario as Scenario)
    ? (rawScenario as Scenario)
    : 'betting-call';
  const rawTableId = Array.isArray(query.tableId) ? query.tableId[0] : query.tableId;
  const rawStatus = Array.isArray(query.status) ? query.status[0] : query.status;
  const state = buildState(scenario, Date.now());
  if (state && typeof rawTableId === 'string') {
    state.id = rawTableId;
  }

  return {
    props: {
      scenario,
      state,
      playerId: scenario === 'join-fallback' || scenario === 'joining-known-name' ? null : HERO_ID,
      debugStatus:
        typeof rawStatus === 'string'
          ? rawStatus
          : scenario === 'joining-known-name'
            ? 'Connecting to Nakama...'
            : 'Connected (test snapshot)',
    },
  };
};

export default function PokerActionTrayTestPage({
  scenario,
  state,
  playerId,
  debugStatus,
}: TestPageProps) {
  const [debugState, setDebugState] = useState<PublicState | null>(state);
  const advanceAllInDiscard = (street: 'turn' | 'river', holeCardsLength: number) => {
    setDebugState(
      allInDiscardTransitionState(Date.now(), street, holeCardsLength, street === 'turn' ? 2 : 3)
    );
  };
  const pushUnrelatedUpdate = () => {
    setDebugState((previous) =>
      previous
        ? {
            ...previous,
            stateVersion: (previous.stateVersion ?? 1) + 1,
            log: [...previous.log, { message: 'Unrelated table update', ts: Date.now() }],
          }
        : previous
    );
  };

  return (
    <>
      <Head>
        <title>Action Tray Test - {scenario}</title>
      </Head>
      {scenario === 'all-in-discard-transition' ? (
        <div style={{ position: 'fixed', left: 0, top: 0, zIndex: 9999, opacity: 0.01 }}>
          <button
            type="button"
            data-testid="debug-advance-turn-discard"
            onClick={() => advanceAllInDiscard('turn', 4)}
          >
            Advance turn discard
          </button>
          <button
            type="button"
            data-testid="debug-advance-river-discard"
            onClick={() => advanceAllInDiscard('river', 3)}
          >
            Advance river discard
          </button>
          <button
            type="button"
            data-testid="debug-unrelated-discard-update"
            onClick={pushUnrelatedUpdate}
          >
            Unrelated update
          </button>
        </div>
      ) : null}
      <PokerGamePage
        forcedMatchId={`test-${scenario}`}
        showExitButton
        debugInitialState={debugState}
        debugPlayerId={playerId}
        debugDisableNetwork
        debugStatus={debugStatus}
      />
    </>
  );
}
