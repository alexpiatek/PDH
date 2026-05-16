export interface StateSnapshotVersionCursor {
  tableId: string | null;
  stateVersion: number | null;
}

export function readSnapshotStateVersion(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== 'object' || !('stateVersion' in snapshot)) {
    return null;
  }
  const stateVersion = (snapshot as { stateVersion?: unknown }).stateVersion;
  return Number.isInteger(stateVersion) && typeof stateVersion === 'number' && stateVersion >= 0
    ? stateVersion
    : null;
}

export function readSnapshotTableId(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || !('id' in snapshot)) {
    return null;
  }
  const tableId = (snapshot as { id?: unknown }).id;
  return typeof tableId === 'string' && tableId.trim().length > 0 ? tableId : null;
}

function isVersionCursor(value: unknown): value is StateSnapshotVersionCursor {
  return Boolean(value && typeof value === 'object' && 'stateVersion' in value && 'tableId' in value);
}

export function shouldApplyStateSnapshot(
  latestAppliedStateVersion: number | StateSnapshotVersionCursor | null,
  incomingSnapshot: unknown
) {
  const incomingVersion = readSnapshotStateVersion(incomingSnapshot);
  // Legacy local WebSocket snapshots predate stateVersion. Keep applying them for dev compatibility.
  if (incomingVersion === null || latestAppliedStateVersion === null) {
    return true;
  }
  if (isVersionCursor(latestAppliedStateVersion)) {
    const incomingTableId = readSnapshotTableId(incomingSnapshot);
    if (
      incomingTableId &&
      latestAppliedStateVersion.tableId &&
      incomingTableId !== latestAppliedStateVersion.tableId
    ) {
      return true;
    }
    if (latestAppliedStateVersion.stateVersion === null) {
      return true;
    }
    return incomingVersion > latestAppliedStateVersion.stateVersion;
  }
  return incomingVersion > latestAppliedStateVersion;
}

export function nextAppliedStateVersion(
  latestAppliedStateVersion: StateSnapshotVersionCursor,
  incomingSnapshot: unknown
): StateSnapshotVersionCursor;
export function nextAppliedStateVersion(
  latestAppliedStateVersion: number | null,
  incomingSnapshot: unknown
): number | null;
export function nextAppliedStateVersion(
  latestAppliedStateVersion: number | StateSnapshotVersionCursor | null,
  incomingSnapshot: unknown
) {
  const incomingVersion = readSnapshotStateVersion(incomingSnapshot);
  if (isVersionCursor(latestAppliedStateVersion)) {
    return {
      tableId: readSnapshotTableId(incomingSnapshot) ?? latestAppliedStateVersion.tableId,
      stateVersion: incomingVersion ?? latestAppliedStateVersion.stateVersion,
    };
  }
  return incomingVersion === null ? latestAppliedStateVersion : incomingVersion;
}
