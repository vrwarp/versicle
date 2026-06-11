/**
 * Row schemas for the APP domain stores (`checkpoints`, `sync_log`,
 * `flight_snapshots`, `app_metadata`) — Phase 3, D4 in
 * plan/overhaul/prep/phase3-storage-gateway.md.
 *
 * See rows/static.ts for the shared posture. Notes:
 * - `sync_log` is a dead store at HEAD (zero readers/writers; prep ▲16) —
 *   its schema is FROZEN as-is for the P4 sync strangler to adopt or P9 to
 *   delete. Do not extend it here.
 * - `app_metadata` is repurposed by the v25 format change (D7:
 *   `schemaHistory` + `legacy-recovery` records). Those envelope schemas
 *   land with the v25 PR — the ONE format change of Phase 3 — not here.
 */
import { z } from 'zod';
import type { SyncCheckpoint, SyncLogEntry } from '~types/sync';
import type { FlightSnapshot } from '~types/flight-recorder';

/** `checkpoints` row (key: autoincrement id). */
export const syncCheckpointRowSchema = z.looseObject({
  id: z.number(),
  timestamp: z.number(),
  blob: z.custom<Uint8Array>((v) => v instanceof Uint8Array, {
    message: 'Expected Uint8Array',
  }),
  size: z.number(),
  trigger: z.string(),
  /**
   * Pin against the rolling prune (pre-migration backups). Additive field:
   * rows persisted before it exist without it and are unprotected.
   */
  protected: z.boolean().optional(),
});
export type SyncCheckpointRow = {
  id: number;
  timestamp: number;
  blob: Uint8Array;
  size: number;
  trigger: string;
  protected?: boolean;
};

/** `sync_log` row — FROZEN (dead store at HEAD, see module docs). */
export const syncLogEntryRowSchema = z.looseObject({
  id: z.number(),
  timestamp: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  details: z.unknown().optional(),
});
export type SyncLogEntryRow = {
  id: number;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: unknown;
};

/** `flight_snapshots` row (key: uuid id). */
export const flightSnapshotRowSchema = z.looseObject({
  id: z.string().min(1),
  createdAt: z.number(),
  trigger: z.string(),
  note: z.string(),
  context: z.looseObject({
    bookId: z.string().nullable(),
    sectionIndex: z.number(),
    currentIndex: z.number(),
    queueLength: z.number(),
    status: z.string(),
    skippedCount: z.number().optional(),
    nextItemSkipped: z.boolean().optional(),
  }),
  eventCount: z.number(),
  timeRange: z.looseObject({ first: z.number(), last: z.number() }),
  eventsJSON: z.string(),
  sizeBytes: z.number(),
});
export type FlightSnapshotRow = {
  id: string;
  createdAt: number;
  trigger: string;
  note: string;
  context: {
    bookId: string | null;
    sectionIndex: number;
    currentIndex: number;
    queueLength: number;
    status: string;
    skippedCount?: number;
    nextItemSkipped?: boolean | undefined;
  };
  eventCount: number;
  timeRange: { first: number; last: number };
  eventsJSON: string;
  sizeBytes: number;
};

// ── Compile-time drift guards (see rows/static.ts for the pattern) ────────
type _CheckpointSchemaMatches = z.infer<typeof syncCheckpointRowSchema> extends SyncCheckpointRow ? true : never;
type _LogSchemaMatches = z.infer<typeof syncLogEntryRowSchema> extends SyncLogEntryRow ? true : never;
type _SnapshotSchemaMatches = z.infer<typeof flightSnapshotRowSchema> extends FlightSnapshotRow ? true : never;
type _CheckpointRound = SyncCheckpointRow extends SyncCheckpoint ? true : never;
type _SnapshotRound = FlightSnapshotRow extends FlightSnapshot ? true : never;
const _schemaChecks: [
  _CheckpointSchemaMatches,
  _LogSchemaMatches,
  _SnapshotSchemaMatches,
  _CheckpointRound,
  _SnapshotRound,
] = [true, true, true, true, true];
void _schemaChecks;

function _rowTypeDriftGuard(
  checkpoint: SyncCheckpoint,
  logEntry: SyncLogEntry,
  snapshot: FlightSnapshot,
): void {
  const _checkpoint: SyncCheckpointRow = checkpoint;
  const _logEntry: SyncLogEntryRow = logEntry;
  const _snapshot: FlightSnapshotRow = snapshot;
  void _checkpoint; void _logEntry; void _snapshot;
}
void _rowTypeDriftGuard;
