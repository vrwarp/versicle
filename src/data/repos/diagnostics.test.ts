/**
 * diagnostics repo contract suite (Phase 3 D5.4 / Test plan R):
 * round-trip, metadata-only projection, and the prune-at-cap invariant
 * carved out of TTSFlightRecorder's raw IDB code.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { diagnostics, MAX_SNAPSHOTS } from './diagnostics';
import { getConnection } from '../connection';
import { idbWriteLockIdle } from '../write-gate';
import type { FlightSnapshotRow } from '../rows/app';

function makeSnapshot(id: string, createdAt: number): FlightSnapshotRow {
  return {
    id,
    createdAt,
    trigger: 'manual',
    note: '',
    context: { bookId: null, sectionIndex: -1, currentIndex: -1, queueLength: 0, status: 'unknown' },
    eventCount: 1,
    timeRange: { first: createdAt, last: createdAt },
    eventsJSON: JSON.stringify([{ seq: 1, ts: 0, wall: createdAt, src: 'APS', ev: 'test' }]),
    sizeBytes: 64,
  };
}

describe('data/repos/diagnostics', () => {
  beforeEach(async () => {
    const db = await getConnection();
    await db.clear('flight_snapshots');
    await idbWriteLockIdle();
  });

  it('round-trips a snapshot and lists metadata WITHOUT eventsJSON, newest first', async () => {
    await diagnostics.saveSnapshot(makeSnapshot('s-old', 1000));
    await diagnostics.saveSnapshot(makeSnapshot('s-new', 2000));

    const full = await diagnostics.getSnapshot('s-old');
    expect(full?.eventsJSON).toContain('"ev":"test"');

    const list = await diagnostics.listSnapshots();
    expect(list.map(s => s.id)).toEqual(['s-new', 's-old']);
    for (const meta of list) {
      expect('eventsJSON' in meta).toBe(false);
    }
  });

  it('prunes oldest-first down to MAX_SNAPSHOTS when saving at the cap', async () => {
    for (let i = 0; i < MAX_SNAPSHOTS; i++) {
      await diagnostics.saveSnapshot(makeSnapshot(`s-${i}`, 1000 + i));
    }
    await diagnostics.saveSnapshot(makeSnapshot('s-newest', 9999));

    const list = await diagnostics.listSnapshots();
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list[0].id).toBe('s-newest');
    expect(list.map(s => s.id)).not.toContain('s-0'); // oldest pruned
  });

  it('deleteSnapshot and clearSnapshots remove rows', async () => {
    await diagnostics.saveSnapshot(makeSnapshot('s-1', 1));
    await diagnostics.saveSnapshot(makeSnapshot('s-2', 2));

    await diagnostics.deleteSnapshot('s-1');
    expect(await diagnostics.getSnapshot('s-1')).toBeNull();
    expect(await diagnostics.getSnapshot('s-2')).not.toBeNull();

    await diagnostics.clearSnapshots();
    expect(await diagnostics.listSnapshots()).toEqual([]);
  });
});
