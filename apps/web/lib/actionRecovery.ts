/** Only stale turn/phase decisions can be resolved by confirming current server state. */
export function isActionStateMismatch(message: string) {
  return /^(?:not your turn|not in betting phase|not in discard phase|player not pending discard|duplicate or stale action sequence)[.!]?$/i.test(
    message.trim()
  );
}
