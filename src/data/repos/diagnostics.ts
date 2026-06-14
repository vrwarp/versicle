/**
 * `flight_snapshots` repository — persisted TTS flight-recorder ring-buffer
 * snapshots (Phase 3, D5.4 in plan/overhaul/prep/phase3-storage-gateway.md;
 * carved from lib/tts/TTSFlightRecorder.ts's raw getDB() CRUD).
 *
 * Worker-safe (the flight recorder lives on the playback hot path in the
 * TTS worker). Zero contention with other repos: this store is touched by
 * nobody else.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import type { FlightSnapshotRow } from '../rows/app';

/** Rolling cap on persisted snapshots (oldest pruned on save). */
export const MAX_SNAPSHOTS = 10;

class DiagnosticsRepo {
  /**
   * Persist one snapshot, pruning the oldest rows down to MAX_SNAPSHOTS in
   * the SAME gated transaction. The createdAt scan happens outside the gate
   * (D1 recipe — only ids/timestamps are read, never eventsJSON payloads).
   */
  async saveSnapshot(snap: FlightSnapshotRow): Promise<void> {
    const db = await getConnection();

    // Readonly metadata scan (cursor; rows can be ~100s of KB of eventsJSON,
    // but cursor.value materializes them anyway — collect only id/createdAt).
    const existing: { id: string; createdAt: number }[] = [];
    {
      const tx = db.transaction('flight_snapshots', 'readonly');
      let cursor = await tx.store.openCursor();
      while (cursor) {
        existing.push({ id: cursor.value.id, createdAt: cursor.value.createdAt });
        cursor = await cursor.continue();
      }
      await tx.done;
    }

    const toDelete: string[] = [];
    if (existing.length >= MAX_SNAPSHOTS) {
      existing.sort((a, b) => a.createdAt - b.createdAt);
      const excess = existing.length - MAX_SNAPSHOTS + 1;
      for (let i = 0; i < excess; i++) {
        toDelete.push(existing[i].id);
      }
    }

    await write(['flight_snapshots'], (tx) => {
      const store = tx.objectStore('flight_snapshots');
      for (const id of toDelete) store.delete(id);
      store.put(snap);
    });
  }

  /** All snapshots, newest first, WITHOUT the heavy eventsJSON payload. */
  async listSnapshots(): Promise<Omit<FlightSnapshotRow, 'eventsJSON'>[]> {
    const db = await getConnection();
    const all = await db.getAll('flight_snapshots');
    return all
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ eventsJSON: _unused, ...meta }) => meta);
  }

  /** One full snapshot (including eventsJSON), or null. */
  async getSnapshot(id: string): Promise<FlightSnapshotRow | null> {
    const db = await getConnection();
    return (await db.get('flight_snapshots', id)) ?? null;
  }

  async deleteSnapshot(id: string): Promise<void> {
    await write(['flight_snapshots'], (tx) => {
      tx.objectStore('flight_snapshots').delete(id);
    });
  }

  async clearSnapshots(): Promise<void> {
    await write(['flight_snapshots'], (tx) => {
      tx.objectStore('flight_snapshots').clear();
    });
  }
}

export const diagnostics = new DiagnosticsRepo();
