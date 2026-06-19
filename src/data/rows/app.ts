/**
 * Row schemas for the APP domain stores (`checkpoints`, `sync_log`,
 * `flight_snapshots`, `app_metadata`) — Phase 3, D4 in
 * plan/overhaul/prep/phase3-storage-gateway.md.
 *
 * See rows/static.ts for the shared posture. Notes:
 * - `sync_log` is a dead store at HEAD (zero readers/writers; prep ▲16) —
 *   its schema is FROZEN as-is for the P4 sync strangler to adopt or P9 to
 *   delete. Do not extend it here.
 * - `app_metadata` was a dead store until the v25 format change (P3-13,
 *   D7) repurposed it as the schema-evolution envelope: `schemaHistory`
 *   (appended on every versionchange upgrade), the `legacy-recovery-v25`
 *   straggler snapshot, and one-time maintenance flags. The typed envelope
 *   lives below.
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

// ── app_metadata: the v25 schema-evolution envelope (D7) ──────────────────

/**
 * Keys of the `app_metadata` key-value store (out-of-line keys). The store
 * existed unused since v18 (prep ▲16/P15); IDB v25 repurposed it. Keys are
 * append-only — never reuse a retired key for a different shape.
 */
export const APP_METADATA_KEYS = {
  /** `SchemaHistoryEntry[]` — one entry appended per versionchange upgrade. */
  schemaHistory: 'schemaHistory',
  /**
   * `LegacyRecoveryRecord` — the v25 straggler guard's snapshot-before-delete
   * of surviving v17/v18 user-data stores (recoverable via support/
   * diagnostics; retention decision owed by P9).
   */
  legacyRecoveryV25: 'legacy-recovery-v25',
  /** `true` once the post-open idle audio `size` backfill completed (v25). */
  audioSizeBackfillV25: 'audio-size-backfill-v25',
  /**
   * `QuotaDailyUsageRow` — the AI-API rate limiter's persisted daily request
   * count for the current Pacific-time day. Lives under this existing
   * key-value store (no dedicated store, no DB bump): last-write-wins, and a
   * stored row whose day-string differs from today counts as zero (daily
   * rollover). Read/written only by src/data/repos/quotaCounter.ts.
   */
  quotaDailyUsage: 'quota-daily-usage',
} as const;

/**
 * One `schemaHistory` entry: a versionchange upgrade that ran to completion.
 * @public C1 row contract: no parse call site yet — kept exported as the
 * drift-guard anchor (`_HistorySchemaMatches` below pins it to the type).
 */
export const schemaHistoryEntrySchema = z.looseObject({
  from: z.number(),
  to: z.number(),
  at: z.number(),
});
export type SchemaHistoryEntry = { from: number; to: number; at: number };

/**
 * One legacy store's captured rows inside the recovery record. `rowsJSON`
 * is a JSON array string (rows serialized one by one so the size cap can
 * stop mid-store); binary fields are elided to
 * `{ __binary: <ctor>, byteLength }` descriptors.
 */
const legacyRecoveryStoreCaptureSchema = z.looseObject({
  store: z.string(),
  rowCount: z.number(),
  capturedCount: z.number(),
  rowsJSON: z.string(),
});
export type LegacyRecoveryStoreCapture = {
  store: string;
  rowCount: number;
  capturedCount: number;
  rowsJSON: string;
};

/**
 * The `legacy-recovery-v25` record (straggler guard, D7 step 1).
 * @public C1 row contract: no parse call site yet — kept exported as the
 * drift-guard anchor (`_RecoverySchemaMatches` below pins it to the type).
 */
export const legacyRecoveryRecordSchema = z.looseObject({
  capturedAt: z.number(),
  fromVersion: z.number(),
  truncated: z.boolean(),
  stores: z.array(legacyRecoveryStoreCaptureSchema),
});
export type LegacyRecoveryRecord = {
  capturedAt: number;
  fromVersion: number;
  truncated: boolean;
  stores: LegacyRecoveryStoreCapture[];
};

/**
 * The `quota-daily-usage` record: the AI-API rate limiter's persisted daily
 * request count. `day` is the Pacific-time day key (`YYYY-MM-DD`); a stored
 * row whose `day` differs from today is treated as zero, giving a once-a-day
 * rollover. Mirrors the in-memory usage shape the limiter tracks, so the
 * adapter that owns the limiter can map between them.
 * @public C1 row contract: parsed via the quotaCounter repo; pinned to the type
 * by `_QuotaSchemaMatches` below.
 */
export const quotaDailyUsageSchema = z.looseObject({
  day: z.string(),
  pools: z.record(z.string(), z.looseObject({
    rpd: z.number(),
    tpm: z.number().optional(),
  })).optional(),
  rpd: z.number().optional(),
  tpm: z.number().optional(),
});
export type QuotaDailyUsageRow = {
  day: string;
  pools?: Record<string, { rpd: number; tpm?: number }>;
  rpd?: number;
  tpm?: number;
};

/**
 * Everything `app_metadata` may hold — the typed envelope replacing the dead
 * store's `any`. Readers narrow by key (see APP_METADATA_KEYS).
 */
export type AppMetadataValue =
  | SchemaHistoryEntry[]
  | LegacyRecoveryRecord
  | QuotaDailyUsageRow
  | boolean;

// ── Compile-time drift guards (see rows/static.ts for the pattern) ────────
type _CheckpointSchemaMatches = z.infer<typeof syncCheckpointRowSchema> extends SyncCheckpointRow ? true : never;
type _LogSchemaMatches = z.infer<typeof syncLogEntryRowSchema> extends SyncLogEntryRow ? true : never;
type _SnapshotSchemaMatches = z.infer<typeof flightSnapshotRowSchema> extends FlightSnapshotRow ? true : never;
type _CheckpointRound = SyncCheckpointRow extends SyncCheckpoint ? true : never;
type _SnapshotRound = FlightSnapshotRow extends FlightSnapshot ? true : never;
type _HistorySchemaMatches = z.infer<typeof schemaHistoryEntrySchema> extends SchemaHistoryEntry ? true : never;
type _RecoverySchemaMatches = z.infer<typeof legacyRecoveryRecordSchema> extends LegacyRecoveryRecord ? true : never;
type _QuotaSchemaMatches = z.infer<typeof quotaDailyUsageSchema> extends QuotaDailyUsageRow ? true : never;
const _schemaChecks: [
  _CheckpointSchemaMatches,
  _LogSchemaMatches,
  _SnapshotSchemaMatches,
  _CheckpointRound,
  _SnapshotRound,
  _HistorySchemaMatches,
  _RecoverySchemaMatches,
  _QuotaSchemaMatches,
] = [true, true, true, true, true, true, true, true];
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
