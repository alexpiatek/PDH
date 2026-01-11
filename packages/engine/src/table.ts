import { buildDeck, shuffle } from './deck';
import { evaluateSeven } from './handEvaluator';
import {
  Card,
  HandLogEntry,
  HandState,
  Phase,
  PlayerAction,
  PlayerInHand,
  PlayerStatus,
  Pot,
  Seat,
  Street,
  TableConfig,
  TableState,
} from './types';

const DEFAULT_CONFIG: TableConfig = {
  smallBlind: 50,
  bigBlind: 100,
  discardTimeoutMs: 8000,
};

function nowTs() {
  return Date.now();
}

function logPush(log: HandLogEntry[] | undefined, message: string) {
  if (log) {
    log.push({ message, ts: nowTs() });
  }
}

function nextOccupiedSeat(seats: (Seat | null)[], start: number): Seat | null {
  if (seats.every((s) => s === null)) return null;
  const max = seats.length;
  for (let i = 1; i <= max; i += 1) {
    const idx = (start + i) % max;
    const seat = seats[idx];
    if (seat) return seat;
  }
  return null;
}

function seatOrderFrom(seats: (Seat | null)[], start: number): Seat[] {
  const result: Seat[] = [];
  for (let i = 1; i <= seats.length; i += 1) {
    const idx = (start + i) % seats.length;
    const seat = seats[idx];
    if (seat) result.push(seat);
  }
  return result;
}

function activePlayers(hand: HandState): PlayerInHand[] {
  return hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
}

function playerBySeat(hand: HandState, seat: number): PlayerInHand {
  const p = hand.players.find((pl) => pl.seat === seat);
  if (!p) {
    throw new Error(`No player at seat ${seat}`);
  }
  return p;
}

function playerById(hand: HandState, id: string): PlayerInHand {
  const p = hand.players.find((pl) => pl.id === id);
  if (!p) {
    throw new Error(`No player with id ${id}`);
  }
  return p;
}

function resetStreetState(hand: HandState, nextStreet: Street, table: TableState) {
  hand.street = nextStreet;
  hand.phase = 'betting';
  hand.currentBet = 0;
  hand.minRaise = table.config.bigBlind;
  hand.lastAggressorSeat = null;
  for (const p of hand.players) {
    p.betThisStreet = 0;
    p.hasActed = p.status !== 'active' ? true : false;
    if (p.status === 'folded' || p.status === 'out' || p.status === 'allIn') {
      p.hasActed = true;
    }
  }
  hand.actionOnSeat = seatAfterButton(table, hand);
  logPush(hand.log, `Starting betting on ${nextStreet}`);
}

function seatAfterButton(table: TableState, hand: HandState): number {
  const order = seatOrderFrom(table.seats, hand.buttonSeat);
  const first = order.find((s) => s && playerBySeat(hand, s.seat).status === 'active');
  if (!first) return hand.buttonSeat;
  return first.seat;
}

export class PokerTable {
  state: TableState;

  constructor(id: string, config?: Partial<TableConfig>, maxSeats = 9) {
    const seats: (Seat | null)[] = new Array(maxSeats).fill(null);
    this.state = {
      id,
      config: { ...DEFAULT_CONFIG, ...config },
      seats,
      buttonSeat: -1,
      hand: null,
      log: [],
    };
  }

  seatPlayer(seat: number, player: Omit<Seat, 'seat'>) {
    if (seat < 0 || seat >= this.state.seats.length) throw new Error('Seat out of range');
    if (this.state.seats[seat]) throw new Error('Seat occupied');
    this.state.seats[seat] = { seat, ...player };
    logPush(this.state.log, `${player.name} sat in seat ${seat}`);
  }

  removePlayer(seat: number) {
    const existing = this.state.seats[seat];
    if (existing) {
      logPush(this.state.log, `${existing.name} left seat ${seat}`);
    }
    this.state.seats[seat] = null;
  }

  startHand(rng: () => number = Math.random) {
    if (this.state.hand) throw new Error('Hand already in progress');
    const seatsIn = this.state.seats.filter((s) => s && !s.sittingOut && s.stack > 0) as Seat[];
    if (seatsIn.length < 2) throw new Error('Need at least two players to start');
    const button =
      this.state.buttonSeat === -1
        ? seatsIn[0].seat
        : nextOccupiedSeat(this.state.seats, this.state.buttonSeat)?.seat ?? seatsIn[0].seat;
    const deck = shuffle(buildDeck(), rng);
    const players: PlayerInHand[] = seatsIn.map((s) => ({
      seat: s.seat,
      id: s.id,
      name: s.name,
      stack: s.stack,
      status: 'active',
      holeCards: [],
      betThisStreet: 0,
      totalCommitted: 0,
      hasActed: false,
    }));
    // Deal 5 hole cards
    for (let i = 0; i < 5; i += 1) {
      for (const p of players) {
        const card = deck.pop();
        if (!card) throw new Error('Deck exhausted');
        p.holeCards.push(card);
      }
    }
    const hand: HandState = {
      handId: `${Date.now()}`,
      buttonSeat: button,
      street: 'preflop',
      phase: 'betting',
      board: [],
      deck,
      players,
      pots: [],
      currentBet: 0,
      minRaise: this.state.config.bigBlind,
      actionOnSeat: 0,
      lastAggressorSeat: null,
      discardPending: [],
      discardDeadline: null,
      log: [],
    };
    // Post blinds and set action order
    this.postBlinds(hand);
    hand.actionOnSeat = this.firstToActPreflop(hand);
    this.state.hand = hand;
    this.state.buttonSeat = button;
    logPush(hand.log, 'Hand started');
  }

  firstToActPreflop(hand: HandState): number {
    const active = activePlayers(hand);
    if (active.length === 2) {
      return hand.buttonSeat; // heads up: button (SB) acts first
    }
    const bbSeat = this.bigBlindSeat(hand);
    const order = seatOrderFrom(this.state.seats, bbSeat);
    const next = order.find((s) => s && playerBySeat(hand, s.seat).status === 'active');
    return next ? next.seat : hand.buttonSeat;
  }

  smallBlindSeat(hand: HandState): number {
    const sb = nextOccupiedSeat(this.state.seats, hand.buttonSeat);
    if (!sb) throw new Error('No small blind seat');
    return sb.seat;
  }

  bigBlindSeat(hand: HandState): number {
    const sb = this.smallBlindSeat(hand);
    const bb = nextOccupiedSeat(this.state.seats, sb);
    if (!bb) throw new Error('No big blind seat');
    return bb.seat;
  }

  postBlinds(hand: HandState) {
    const sbSeat = this.smallBlindSeat(hand);
    const bbSeat = this.bigBlindSeat(hand);
    const sbPlayer = playerBySeat(hand, sbSeat);
    const bbPlayer = playerBySeat(hand, bbSeat);
    this.commitBet(hand, sbPlayer, Math.min(this.state.config.smallBlind, sbPlayer.stack));
    logPush(hand.log, `${sbPlayer.name} posted small blind ${this.state.config.smallBlind}`);
    this.commitBet(hand, bbPlayer, Math.min(this.state.config.bigBlind, bbPlayer.stack));
    hand.currentBet = Math.min(this.state.config.bigBlind, bbPlayer.betThisStreet);
    hand.minRaise = this.state.config.bigBlind;
    logPush(hand.log, `${bbPlayer.name} posted big blind ${this.state.config.bigBlind}`);
    hand.lastAggressorSeat = bbSeat;
  }

  commitBet(hand: HandState, player: PlayerInHand, amount: number) {
    const pay = Math.min(amount, player.stack);
    player.stack -= pay;
    player.betThisStreet += pay;
    player.totalCommitted += pay;
    const seat = this.state.seats[player.seat];
    if (seat) {
      seat.stack -= pay;
      if (seat.stack < 0) seat.stack = 0;
    }
    if (player.stack === 0 && player.status === 'active') {
      player.status = 'allIn';
      player.hasActed = true;
    }
  }

  actionTurnSeat(hand: HandState): PlayerInHand {
    return playerBySeat(hand, hand.actionOnSeat);
  }

  applyAction(playerId: string, action: PlayerAction) {
    const hand = this.state.hand;
    if (!hand) throw new Error('No hand in progress');
    if (hand.phase !== 'betting') throw new Error('Not in betting phase');
    const player = playerById(hand, playerId);
    if (player.seat !== hand.actionOnSeat) throw new Error('Not your turn');
    if (player.status !== 'active') throw new Error('Player cannot act');
    const toCall = hand.currentBet - player.betThisStreet;

    switch (action.type) {
      case 'fold':
        player.status = 'folded';
        player.hasActed = true;
        logPush(hand.log, `${player.name} folded`);
        break;
      case 'check':
        if (toCall !== 0) throw new Error('Cannot check');
        player.hasActed = true;
        logPush(hand.log, `${player.name} checked`);
        break;
      case 'call': {
        if (toCall === 0) throw new Error('Nothing to call');
        const pay = Math.min(toCall, player.stack);
        this.commitBet(hand, player, pay);
        player.hasActed = true;
        logPush(hand.log, `${player.name} called ${pay}`);
        break;
      }
      case 'bet': {
        if (hand.currentBet !== 0) throw new Error('Cannot bet, must raise');
        if (action.amount < this.state.config.bigBlind) throw new Error('Bet below minimum');
        this.placeRaise(hand, player, action.amount);
        break;
      }
      case 'raise': {
        if (action.amount <= hand.currentBet) throw new Error('Raise must exceed current bet');
        const raiseBy = action.amount - hand.currentBet;
        if (raiseBy < hand.minRaise && action.amount < player.betThisStreet + player.stack) {
          throw new Error('Raise below minimum');
        }
        this.placeRaise(hand, player, action.amount);
        break;
      }
      case 'allIn': {
        const target = action.amount ?? player.betThisStreet + player.stack;
        const desired = Math.min(target, player.betThisStreet + player.stack);
        if (desired <= hand.currentBet && toCall === 0) {
          // shove for zero change is a check
          player.hasActed = true;
          logPush(hand.log, `${player.name} is all-in for ${desired}`);
          break;
        }
        const newTotal = Math.min(desired, player.betThisStreet + player.stack);
        if (newTotal <= hand.currentBet) {
          // short all-in call
          const pay = newTotal - player.betThisStreet;
          this.commitBet(hand, player, pay);
          player.hasActed = true;
          logPush(hand.log, `${player.name} called all-in for ${pay}`);
        } else {
          // all-in raise
          this.placeRaise(hand, player, newTotal);
        }
        break;
      }
      default:
        throw new Error('Unknown action');
    }

    if (this.isBettingRoundComplete(hand)) {
      this.finishBettingRound();
    } else {
      hand.actionOnSeat = this.nextToAct(hand);
    }
  }

  private placeRaise(hand: HandState, player: PlayerInHand, newTotalBet: number) {
    const contributionNeeded = newTotalBet - player.betThisStreet;
    const actualTotal = Math.min(newTotalBet, player.betThisStreet + player.stack);
    const pay = actualTotal - player.betThisStreet;
    this.commitBet(hand, player, pay);
    const raiseBy = actualTotal - hand.currentBet;
    const fullRaise = raiseBy >= hand.minRaise;
    if (actualTotal > hand.currentBet) {
      hand.currentBet = actualTotal;
      if (fullRaise) {
        hand.minRaise = raiseBy;
        hand.lastAggressorSeat = player.seat;
        for (const p of hand.players) {
          if (p.status === 'active') {
            p.hasActed = false;
          }
          if (p.status === 'allIn' || p.status === 'folded' || p.id === player.id) {
            p.hasActed = true;
          }
        }
      }
    }
    player.hasActed = true;
    const actionWord = player.stack === 0 ? 'all-in' : fullRaise ? 'raised' : 'raised short';
    logPush(hand.log, `${player.name} ${actionWord} to ${actualTotal}`);
  }

  private nextToAct(hand: HandState): number {
    const order = seatOrderFrom(this.state.seats, hand.actionOnSeat);
    for (const s of order) {
      if (!s) continue;
      const p = playerBySeat(hand, s.seat);
      if (p.status === 'active' && (p.betThisStreet < hand.currentBet || !p.hasActed)) {
        return s.seat;
      }
    }
    // fallback
    return hand.actionOnSeat;
  }

  private isBettingRoundComplete(hand: HandState): boolean {
    const active = hand.players.filter((p) => p.status === 'active');
    if (active.length === 0) return true;
    if (active.length === 1) return true;
    const canAct = active.filter((p) => p.stack > 0);
    if (canAct.length === 0) return true;
    const allMatched = hand.players.every(
      (p) =>
        p.status !== 'active' || p.betThisStreet === hand.currentBet || p.stack === 0,
    );
    const allActed = hand.players.every(
      (p) => p.status !== 'active' || p.hasActed || p.stack === 0,
    );
    return allMatched && allActed;
  }

  private finishBettingRound() {
    const hand = this.state.hand;
    if (!hand) return;
    // Move to discard or next street/showdown
    if (hand.street === 'preflop') {
      this.revealFlop(hand);
      resetStreetState(hand, 'flop', this.state);
    } else if (hand.street === 'flop' || hand.street === 'turn') {
      this.beginDiscardPhase();
    } else if (hand.street === 'river') {
      this.beginDiscardPhase();
    }
  }

  private revealFlop(hand: HandState) {
    for (let i = 0; i < 3; i += 1) {
      const card = hand.deck.pop();
      if (!card) throw new Error('Deck exhausted');
      hand.board.push(card);
    }
    logPush(hand.log, `Flop: ${hand.board.map((c) => `${c.rank}${c.suit}`).join(' ')}`);
  }

  private revealSingle(hand: HandState, label: string) {
    const card = hand.deck.pop();
    if (!card) throw new Error('Deck exhausted');
    hand.board.push(card);
    logPush(hand.log, `${label}: ${card.rank}${card.suit}`);
  }

  private beginDiscardPhase() {
    const hand = this.state.hand;
    if (!hand) return;
    hand.phase = 'discard';
    hand.discardPending = activePlayers(hand)
      .filter((p) => p.holeCards.length > 2)
      .map((p) => p.id);
    hand.discardDeadline = nowTs() + this.state.config.discardTimeoutMs;
    logPush(hand.log, `Discard phase started (${hand.discardPending.length} to act)`);
    if (hand.discardPending.length === 0) {
      this.completeDiscardPhase();
    }
  }

  applyDiscard(playerId: string, cardIndex: number) {
    const hand = this.state.hand;
    if (!hand) throw new Error('No hand in progress');
    if (hand.phase !== 'discard') throw new Error('Not in discard phase');
    if (!hand.discardPending.includes(playerId)) throw new Error('Player not pending discard');
    const player = playerById(hand, playerId);
    this.discardCard(player, cardIndex, false);
    hand.discardPending = hand.discardPending.filter((id) => id !== playerId);
    if (hand.discardPending.length === 0) {
      this.completeDiscardPhase();
    }
  }

  private discardCard(player: PlayerInHand, cardIndex: number, auto: boolean) {
    const card = player.holeCards[cardIndex];
    if (!card) throw new Error('Invalid discard index');
    player.holeCards.splice(cardIndex, 1);
    logPush(
      this.state.hand?.log,
      `${player.name} discarded${auto ? ' (auto)' : ''}`,
    );
  }

  autoDiscard(now: number = nowTs()) {
    const hand = this.state.hand;
    if (!hand || hand.phase !== 'discard' || hand.discardDeadline === null) return;
    if (now < hand.discardDeadline) return;
    const pending = [...hand.discardPending];
    for (const pid of pending) {
      const player = playerById(hand, pid);
      this.discardCard(player, 0, true);
    }
    hand.discardPending = [];
    this.completeDiscardPhase();
  }

  private completeDiscardPhase() {
    const hand = this.state.hand;
    if (!hand) return;
    hand.discardDeadline = null;
    hand.discardPending = [];
    if (hand.street === 'flop') {
      this.revealSingle(hand, 'Turn');
      resetStreetState(hand, 'turn', this.state);
    } else if (hand.street === 'turn') {
      this.revealSingle(hand, 'River');
      resetStreetState(hand, 'river', this.state);
    } else if (hand.street === 'river') {
      hand.phase = 'showdown';
      this.finishHand();
    }
  }

  private finishHand() {
    const hand = this.state.hand;
    if (!hand) return;
    const finalize = () => {
      hand.phase = 'complete';
      this.state.log.push(...hand.log);
      this.state.hand = null;
      // advance button
      const nextBtn = nextOccupiedSeat(this.state.seats, this.state.buttonSeat);
      if (nextBtn) {
        this.state.buttonSeat = nextBtn.seat;
      }
      this.beginNextHandIfReady();
    };
    // If only one active player, award pot
    const contenders = hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
    if (contenders.length === 1) {
      const winner = contenders[0];
      const totalPot = hand.players.reduce((sum, p) => sum + p.totalCommitted, 0);
      const seat = this.state.seats[winner.seat];
      if (seat) seat.stack += totalPot;
      logPush(hand.log, `${winner.name} wins ${totalPot} uncontested`);
      finalize();
      return;
    }
    this.buildSidePots(hand);
    const results = this.scoreShowdown(hand);
    for (const res of results) {
      const seat = this.state.seats[res.player.seat];
      if (seat) seat.stack += res.amount;
      logPush(hand.log, `${res.player.name} wins ${res.amount}`);
    }
    finalize();
  }

  private buildSidePots(hand: HandState) {
    const contributions = hand.players
      .filter((p) => p.totalCommitted > 0)
      .map((p) => ({ id: p.id, seat: p.seat, amount: p.totalCommitted }))
      .sort((a, b) => a.amount - b.amount);
    const live = new Set(
      hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out').map((p) => p.id),
    );
    let remaining = contributions.map((c) => ({ ...c }));
    const pots: Pot[] = [];
    let prevLevel = 0;
    while (remaining.length) {
      const level = remaining[0].amount;
      const tier = level - prevLevel;
      if (tier > 0) {
        const eligible = remaining.filter((c) => live.has(c.id)).map((c) => c.id);
        const potAmount = tier * remaining.length;
        pots.push({ amount: potAmount, eligible });
      }
      prevLevel = level;
      remaining = remaining
        .map((c) => ({ ...c, amount: c.amount - level }))
        .filter((c) => c.amount > 0);
    }
    hand.pots = pots;
  }

  private scoreShowdown(hand: HandState) {
    const contenders = hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
    const evaluations = contenders.map((p) => ({
      player: p,
      eval: evaluateSeven([...hand.board, ...p.holeCards]),
    }));
    const award: { player: PlayerInHand; amount: number }[] = [];
    for (const pot of hand.pots) {
      const eligible = evaluations.filter((e) => pot.eligible.includes(e.player.id));
      if (eligible.length === 0) continue;
      let best = Math.max(...eligible.map((e) => e.eval.score));
      const winners = eligible.filter((e) => e.eval.score === best);
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount % winners.length;
      const orderedWinners = this.orderWinnersByButton(winners.map((w) => w.player), hand.buttonSeat);
      winners.forEach((w) => award.push({ player: w.player, amount: share }));
      if (remainder > 0 && orderedWinners.length > 0) {
        award.push({ player: orderedWinners[0], amount: remainder });
      }
    }
    return award;
  }

  private orderWinnersByButton(players: PlayerInHand[], buttonSeat: number): PlayerInHand[] {
    const seatOrder = seatOrderFrom(this.state.seats, buttonSeat).map((s) => s?.seat);
    return players.sort((a, b) => seatOrder.indexOf(a.seat) - seatOrder.indexOf(b.seat));
  }

  beginNextHandIfReady() {
    if (this.state.hand) return;
    const ready = this.state.seats.filter((s) => s && s.stack > 0) as Seat[];
    if (ready.length >= 2) {
      this.startHand();
    }
  }

  getPublicState(forPlayerId?: string) {
    const hand = this.state.hand;
    return {
      id: this.state.id,
      seats: this.state.seats,
      buttonSeat: this.state.buttonSeat,
      hand: hand
        ? {
            ...hand,
            players: hand.players.map((p) => ({
              ...p,
              holeCards: forPlayerId && p.id === forPlayerId ? p.holeCards : p.holeCards.map(() => ({ rank: 'X', suit: 'X' } as unknown as Card)),
            })),
            deck: [],
          }
        : null,
      log: [...this.state.log, ...(hand?.log ?? [])],
    };
  }
}
