import { describe, expect, it } from 'vitest';
import {
  nextAppliedStateVersion,
  readSnapshotStateVersion,
  shouldApplyStateSnapshot,
} from '../lib/stateVersion';

describe('state snapshot version handling', () => {
  it('reads valid snapshot versions', () => {
    expect(readSnapshotStateVersion({ stateVersion: 4 })).toBe(4);
    expect(readSnapshotStateVersion({ stateVersion: -1 })).toBeNull();
    expect(readSnapshotStateVersion({ stateVersion: 1.5 })).toBeNull();
    expect(readSnapshotStateVersion({})).toBeNull();
  });

  it('ignores stale and duplicate versioned snapshots', () => {
    expect(shouldApplyStateSnapshot(7, { stateVersion: 6 })).toBe(false);
    expect(shouldApplyStateSnapshot(7, { stateVersion: 7 })).toBe(false);
    expect(shouldApplyStateSnapshot(7, { stateVersion: 8 })).toBe(true);
  });

  it('keeps applying legacy snapshots without stateVersion', () => {
    expect(shouldApplyStateSnapshot(7, { id: 'legacy-local' })).toBe(true);
    expect(nextAppliedStateVersion(7, { id: 'legacy-local' })).toBe(7);
  });
});
