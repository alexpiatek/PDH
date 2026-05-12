import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import PokerGamePage from '../../components/PokerGamePage';
import type { PublicState } from '../../server-types';

type Scenario = 'betting-call' | 'betting-check-allin' | 'discard' | 'showdown';

interface TestPageProps {
  scenario: Scenario;
  state: PublicState;
}

const HERO_ID = 'player-hero';
const VILLAIN_ID = 'player-villain';

const scenarios = new Set<Scenario>(['betting-call', 'betting-check-allin', 'discard', 'showdown']);

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
      log: [{ message: 'Starting betting on flop', ts: now - 3000 }],
    },
    log: [{ message: 'Starting betting on flop', ts: now - 3000 }],
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

const buildState = (scenario: Scenario, now: number) => {
  switch (scenario) {
    case 'betting-check-allin':
      return bettingCheckAllInState(now);
    case 'discard':
      return discardState(now);
    case 'showdown':
      return showdownState(now);
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

  return {
    props: {
      scenario,
      state: buildState(scenario, Date.now()),
    },
  };
};

export default function PokerActionTrayTestPage({ scenario, state }: TestPageProps) {
  return (
    <>
      <Head>
        <title>Action Tray Test - {scenario}</title>
      </Head>
      <PokerGamePage
        forcedMatchId={`test-${scenario}`}
        showExitButton={false}
        debugInitialState={state}
        debugPlayerId={HERO_ID}
        debugDisableNetwork
      />
    </>
  );
}
