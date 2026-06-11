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
 * Consumed by BackupService (file restore) and lib/sync/android-backup (the
 * android payload read) — both untrusted ingresses named by D4. Lives here,
 * not in BackupService, so the leaf schema can be imported without dragging
 * the backup orchestration (and its store imports) into the graph.
 */
import { z } from 'zod';

export const backupManifestEnvelopeSchema = z.looseObject({
  version: z.union([z.literal(2), z.literal(3)]),
  timestamp: z.string(),
  yjsSnapshot: z.string().min(1),
  staticManifests: z.array(z.looseObject({ bookId: z.string() })).optional(),
  locations: z.array(z.looseObject({ bookId: z.string() })).optional(),
});
export type BackupManifestEnvelope = z.infer<typeof backupManifestEnvelopeSchema>;
