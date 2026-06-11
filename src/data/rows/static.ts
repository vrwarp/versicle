/**
 * Row schemas for the STATIC domain stores (`static_manifests`,
 * `static_resources`, `static_structure`) — Phase 3, D4 in
 * plan/overhaul/prep/phase3-storage-gateway.md.
 *
 * zod is the single source of truth for the PERSISTED shapes; the inferred
 * `*Row` types are the row types the repos speak. The `~types/book`
 * interfaces remain the domain-facing types (the 59-importer shim chain
 * stays compile-stable); compile-time assertions at the bottom of this file
 * keep the two from drifting.
 *
 * Posture (D4 rules):
 * - `z.looseObject` at the envelope: unknown fields written by other builds
 *   pass through untouched (forward compatibility, same stance as the P0
 *   backup envelope).
 * - Strict required keys: a row missing its identity/required fields fails.
 * - Binary fields via `z.custom`: WebKit's IDB structured clone cannot store
 *   Blob, so ingest normalizes Blob → ArrayBuffer at write time; rows
 *   written by pre-normalization builds may still hold a Blob. BOTH are
 *   valid persisted states (which is why these schemas accept the union even
 *   where the `~types` interface still says `Blob`).
 * - Validation runs at untrusted ingress only (backup restore, the android
 *   payload read) — never on the hot read/write path.
 */
import { z } from 'zod';
import type {
  NavigationItem,
  StaticBookManifest,
  StaticResource,
  StaticStructure,
} from '~types/book';

/** A persisted binary: ArrayBuffer (canonical, WebKit-safe) or legacy Blob. */
export const binaryValueSchema = z.custom<ArrayBuffer | Blob>(
  (v) => v instanceof ArrayBuffer || v instanceof Blob,
  { message: 'Expected ArrayBuffer or Blob' },
);

export const perceptualPaletteSchema = z.looseObject({
  standout: z.number(),
  background: z.number(),
  deltaE: z.number(),
});

export const navigationItemSchema: z.ZodType<NavigationItem> = z.lazy(() =>
  z.looseObject({
    id: z.string(),
    href: z.string(),
    label: z.string(),
    subitems: z.array(navigationItemSchema).optional(),
    parent: z.string().optional(),
  }),
) as unknown as z.ZodType<NavigationItem>;

/** `static_manifests` row (key: bookId). */
export const staticManifestRowSchema = z.looseObject({
  bookId: z.string().min(1),
  title: z.string(),
  author: z.string(),
  description: z.string().optional(),
  isbn: z.string().optional(),
  fileHash: z.string(),
  fileSize: z.number(),
  totalChars: z.number(),
  schemaVersion: z.number(),
  /**
   * Cover thumbnail. Canonically ArrayBuffer (ingest converts; WebKit IDB
   * cannot clone Blob); Blob in legacy rows. Rows corrupted to `{}` by
   * pre-v3 backup restores are NOT valid — MaintenanceService
   * `repairCorruptCoverBlobs` strips them.
   */
  coverBlob: binaryValueSchema.optional(),
  coverPalette: z.array(z.number()).optional(),
  perceptualPalette: perceptualPaletteSchema.optional(),
  language: z.string().optional(),
  baseFontSize: z.number().optional(),
  baseLineHeight: z.number().optional(),
});
export type StaticManifestRow = z.infer<typeof staticManifestRowSchema>;

/** `static_resources` row (key: bookId). */
export const staticResourceRowSchema = z.looseObject({
  bookId: z.string().min(1),
  epubBlob: binaryValueSchema,
});
export type StaticResourceRow = z.infer<typeof staticResourceRowSchema>;

export const spineItemSchema = z.looseObject({
  id: z.string(),
  characterCount: z.number(),
  index: z.number(),
});

/** `static_structure` row (key: bookId). */
export const staticStructureRowSchema = z.looseObject({
  bookId: z.string().min(1),
  toc: z.array(navigationItemSchema),
  spineItems: z.array(spineItemSchema),
});
export type StaticStructureRow = z.infer<typeof staticStructureRowSchema>;

/**
 * A `staticManifests` row as it appears INSIDE a backup file (the untrusted
 * restore ingress): v3 carries the cover as base64 (`coverBlobBase64`);
 * v2 rows may carry a real binary cover (in-memory manifests) or JSON
 * garbage (`coverBlob: {}`) which the restore sanitizer strips. Only the
 * row identity plus the fields the restore path actually interprets are
 * type-checked; everything else passes through loosely so old backups keep
 * restoring (observe-then-enforce).
 */
export const backupStaticManifestRowSchema = z.looseObject({
  bookId: z.string().min(1),
  title: z.string().optional(),
  author: z.string().optional(),
  coverBlobBase64: z.string().optional(),
  // Deliberately unvalidated: v2 rows legitimately carry `{}` garbage here;
  // sanitizeManifestRow decides what survives.
  coverBlob: z.unknown().optional(),
});
export type BackupStaticManifestRow = z.infer<typeof backupStaticManifestRowSchema>;

// ── Compile-time drift guards against the ~types/book interfaces ──────────
// (types/ may not import src/data — types-imports-nothing stays 0 — so the
// assertion lives here, on the data side.) The function never runs; its body
// fails to COMPILE if the schemas drift from the domain interfaces.
// Direction 1 (spread assignments): every interface value is a valid row —
// spread is required because interfaces lack the implicit index signature a
// loose row type carries. The reverse is deliberately untrue for binary
// fields: rows store ArrayBuffer where the interface says Blob.
// Direction 2 (conditional type): every structure row satisfies the domain
// interface consumers expect.
function _rowTypeDriftGuard(
  m: Omit<StaticBookManifest, 'coverBlob'>,
  r: StaticResource,
  s: StaticStructure,
): void {
  const _m: Omit<StaticManifestRow, 'coverBlob'> = { ...m };
  const _r: StaticResourceRow = { ...r };
  const _s: StaticStructureRow = { ...s };
  void _m;
  void _r;
  void _s;
}
void _rowTypeDriftGuard;
type _StructureRound = StaticStructureRow extends StaticStructure ? true : never;
const _structureRound: _StructureRound = true;
void _structureRound;
