export type DiscardConfirmDisabledReason =
  | 'not_pending_discard'
  | 'no_selected_card'
  | 'invalid_selected_index'
  | 'request_in_flight'
  | 'disconnected';

export interface DiscardObligationInput {
  handId: string | null | undefined;
  street: string | null | undefined;
  playerId: string | null | undefined;
  pending: boolean;
  holeCardsLength: number;
}

export function discardObligationKey({
  handId,
  street,
  playerId,
  pending,
  holeCardsLength,
}: DiscardObligationInput): string | null {
  if (!pending || !handId || !street || !playerId || holeCardsLength <= 2) {
    return null;
  }
  return `${handId}:${street}:${playerId}:${holeCardsLength}`;
}

export interface DiscardConfirmInput {
  pending: boolean;
  selectedIndex: number | null;
  selectedIndexValid: boolean;
  requestInFlight: boolean;
  disconnected: boolean;
}

export function discardConfirmDisabledReason({
  pending,
  selectedIndex,
  selectedIndexValid,
  requestInFlight,
  disconnected,
}: DiscardConfirmInput): DiscardConfirmDisabledReason | null {
  if (!pending) return 'not_pending_discard';
  if (requestInFlight) return 'request_in_flight';
  if (selectedIndex === null) return 'no_selected_card';
  if (!selectedIndexValid) return 'invalid_selected_index';
  if (disconnected) return 'disconnected';
  return null;
}
