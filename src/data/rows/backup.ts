/**
 * The backup-manifest ENVELOPE schema — the untrusted restore ingress
 * (Phase 3, D4 in plan/overhaul/prep/phase3-storage-gateway.md).
 *
 * Structural validation for restorable backup manifests (v2 and v3).
 * Deliberately loose beyond the envelope so old v2 files keep restoring;
 * per-row validation (backupStaticManifestRowSchema / bookLocationsRowSchema)
 * plus binary sanitization happen at write time in
 * BackupService.processManifest.
 *
 * Consumed by BackupService (file restore) — the untrusted ingress named by
 * D4. (The other D4 ingress, lib/sync/android-backup, was deleted in P9 —
 * docs/adr/0002-android-backup.md.) Lives here, not in BackupService, so
 * the leaf schema can be imported without dragging the backup orchestration
 * (and its store imports) into the graph.
 */
import { z } from 'zod';

export const backupManifestEnvelopeSchema = z.looseObject({
  version: z.union([z.literal(2), z.literal(3)]),
  timestamp: z.string(),
  yjsSnapshot: z.string().min(1),
  staticManifests: z.array(z.looseObject({ bookId: z.string() })).optional(),
  locations: z.array(z.looseObject({ bookId: z.string() })).optional(),
});