import { describe, expect, it } from 'vitest';
import {
  nextAppliedStateVersion,
  readSnapshotStateVersion,
  readSnapshotTableId,
  shouldApplyStateSnapshot,
  type StateSnapshotVersionCursor,
} from '../lib/stateVersion';

describe('state snapshot version handling', () => {
  it('reads valid snapshot versions', () => {
    expect(readSnapshotStateVersion({ stateVersion: 4 })).toBe(4);
    expect(readSnapshotStateVersion({ stateVersion: -1 })).toBeNull();
    expect(readSnapshotStateVersion({ stateVersion: 1.5 })).toBeNull();
    expect(readSnapshotStateVersion({})).toBeNull();
  });

  it('reads valid snapshot table ids', () => {
    expect(readSnapshotTableId({ id: 'TABLE1' })).toBe('TABLE1');
    expect(readSnapshotTableId({ id: '' })).toBeNull();
    expect(readSnapshotTableId({ id: 123 })).toBeNull();
    expect(readSnapshotTableId({})).toBeNull();
  });

  it('ignores stale and duplicate versioned snapshots', () => {
    expect(shouldApplyStateSnapshot(7, { stateVersion: 6 })).toBe(false);
    expect(shouldApplyStateSnapshot(7, { stateVersion: 7 })).toBe(false);
    expect(shouldApplyStateSnapshot(7, { stateVersion: 8 })).toBe(true);
  });

  it('scopes version cursors to the table id', () => {
    const cursor: StateSnapshotVersionCursor = { tableId: 'TABLE_A', stateVersion: 50 };

    expect(shouldApplyStateSnapshot(cursor, { id: 'TABLE_A', stateVersion: 49 })).toBe(false);
    expect(shouldApplyStateSnapshot(cursor, { id: 'TABLE_B', stateVersion: 1 })).toBe(true);
    expect(nextAppliedStateVersion(cursor, { id: 'TABLE_B', stateVersion: 1 })).toEqual({
      tableId: 'TABLE_B',
      stateVersion: 1,
    });
  });

  it('keeps applying legacy snapshots without stateVersion', () => {
    expect(shouldApplyStateSnapshot(7, { id: 'legacy-local' })).toBe(true);
    expect(nextAppliedStateVersion(7, { id: 'legacy-local' })).toBe(7);
  });
});
