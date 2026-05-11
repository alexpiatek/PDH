export function readSnapshotStateVersion(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== 'object' || !('stateVersion' in snapshot)) {
    return null;
  }
  const stateVersion = (snapshot as { stateVersion?: unknown }).stateVersion;
  return Number.isInteger(stateVersion) && typeof stateVersion === 'number' && stateVersion >= 0
    ? stateVersion
    : null;
}

export function shouldApplyStateSnapshot(
  latestAppliedStateVersion: number | null,
  incomingSnapshot: unknown
) {
  const incomingVersion = readSnapshotStateVersion(incomingSnapshot);
  // Legacy local WebSocket snapshots predate stateVersion. Keep applying them for dev compatibility.
  if (incomingVersion === null || latestAppliedStateVersion === null) {
    return true;
  }
  return incomingVersion > latestAppliedStateVersion;
}

export function nextAppliedStateVersion(
  latestAppliedStateVersion: number | null,
  incomingSnapshot: unknown
) {
  const incomingVersion = readSnapshotStateVersion(incomingSnapshot);
  return incomingVersion === null ? latestAppliedStateVersion : incomingVersion;
}
