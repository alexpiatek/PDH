import type { HandState, PlayerInHand } from '@pdh/engine';
import type { LegalActions } from '@pdh/protocol';

export interface BettingActionControlInput {
  hand: HandState | null;
  player: PlayerInHand | null;
  legalActions?: LegalActions | null;
  preferLegalActions: boolean;
  betAmount: number;
  raiseCapReached: boolean;
}

export interface BettingActionControls {
  usesServerLegalActions: boolean;
  isMyTurn: boolean;
  toCall: number;
  currentBet: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  allInTotal: number | null;
  normalizedBetAmount: number;
  clampedRaiseTo: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  canAllIn: boolean;
  canCheckOrCall: boolean;
  canOpenRaiseDrawer: boolean;
  canShortOpenAllIn: boolean;
  isCallAllIn: boolean;
  raiseActionLabel: 'Bet' | 'Raise';
  checkOrCallLabel: string;
}

const cleanAmount = (amount: number) =>
  Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;

export function resolveBettingActionControls({
  hand,
  player,
  legalActions,
  preferLegalActions,
  betAmount,
  raiseCapReached,
}: BettingActionControlInput): BettingActionControls {
  const betting =
    preferLegalActions && legalActions?.phase === 'betting' ? legalActions.betting : undefined;
  const usesServerLegalActions = Boolean(preferLegalActions && legalActions);
  const serverActor = Boolean(legalActions?.phase === 'betting' && legalActions.isActor && betting);
  const legacyActor = Boolean(
    hand && player && hand.phase === 'betting' && hand.actionOnSeat === player.seat
  );
  const isMyTurn = usesServerLegalActions ? serverActor : legacyActor;
  const currentBet = betting?.currentBet ?? hand?.currentBet ?? 0;
  const stack = betting?.stack ?? player?.stack ?? 0;
  const toCall =
    betting?.callAmount ??
    (hand && player ? Math.max(0, hand.currentBet - player.betThisStreet) : 0);
  const minRaiseTo =
    betting && currentBet === 0
      ? betting.minBet
      : betting
        ? betting.minRaiseTo
        : hand
          ? hand.currentBet === 0
            ? hand.minRaise
            : hand.currentBet + hand.minRaise
          : null;
  const maxRaiseTo =
    betting && currentBet === 0
      ? betting.maxBet
      : betting
        ? betting.maxRaiseTo
        : player
          ? player.stack + player.betThisStreet
          : null;
  const allInTotal = betting?.allInAmount ?? (player ? player.stack + player.betThisStreet : null);
  const normalizedBetAmount = cleanAmount(betAmount);
  const clampedRaiseTo =
    minRaiseTo !== null && maxRaiseTo !== null
      ? Math.min(maxRaiseTo, Math.max(minRaiseTo, normalizedBetAmount))
      : normalizedBetAmount;
  const baseCanBet = usesServerLegalActions
    ? Boolean(betting?.canBet)
    : Boolean(
        isMyTurn &&
        hand &&
        hand.currentBet === 0 &&
        !raiseCapReached &&
        minRaiseTo !== null &&
        maxRaiseTo !== null &&
        maxRaiseTo >= minRaiseTo
      );
  const baseCanRaise = usesServerLegalActions
    ? Boolean(betting?.canRaise)
    : Boolean(
        isMyTurn &&
        hand &&
        hand.currentBet > 0 &&
        !raiseCapReached &&
        minRaiseTo !== null &&
        maxRaiseTo !== null &&
        maxRaiseTo >= minRaiseTo
      );
  const canAllIn = usesServerLegalActions
    ? Boolean(betting?.canAllIn)
    : Boolean(isMyTurn && player && player.stack > 0 && allInTotal !== null);
  const canFold = usesServerLegalActions ? Boolean(betting?.canFold) : Boolean(isMyTurn);
  const canCheck = usesServerLegalActions
    ? Boolean(betting?.canCheck)
    : Boolean(isMyTurn && toCall === 0);
  const canCall = usesServerLegalActions
    ? Boolean(betting?.canCall)
    : Boolean(isMyTurn && toCall > 0);
  const canRaise = Boolean(
    isMyTurn &&
    (currentBet === 0 ? baseCanBet : baseCanRaise) &&
    minRaiseTo !== null &&
    maxRaiseTo !== null &&
    maxRaiseTo >= minRaiseTo &&
    clampedRaiseTo >= minRaiseTo &&
    clampedRaiseTo <= maxRaiseTo &&
    clampedRaiseTo > currentBet
  );
  const isCallAllIn = Boolean(isMyTurn && toCall > 0 && canAllIn && stack <= toCall);
  const canCheckOrCall = Boolean(canCheck || canCall || isCallAllIn);
  const canOpenRaiseDrawer = Boolean(isMyTurn && (baseCanBet || baseCanRaise));
  const canShortOpenAllIn = Boolean(
    isMyTurn && currentBet === 0 && canAllIn && !baseCanBet && stack > 0
  );
  const raiseActionLabel = currentBet === 0 ? 'Bet' : 'Raise';
  const checkOrCallLabel =
    toCall === 0 ? 'Check' : isCallAllIn ? `All-in ${stack}` : `Call ${toCall}`;

  return {
    usesServerLegalActions,
    isMyTurn,
    toCall,
    currentBet,
    minRaiseTo,
    maxRaiseTo,
    allInTotal,
    normalizedBetAmount,
    clampedRaiseTo,
    canFold,
    canCheck,
    canCall,
    canBet: baseCanBet,
    canRaise,
    canAllIn,
    canCheckOrCall,
    canOpenRaiseDrawer,
    canShortOpenAllIn,
    isCallAllIn,
    raiseActionLabel,
    checkOrCallLabel,
  };
}
