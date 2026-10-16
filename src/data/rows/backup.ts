/**
 * The backup-manifest ENVELOPE schema — the untrusted restore ingress.
 *
 * Structural validation for restorable backup manifests (v2 and v3).
 * Deliberately loose beyond the envelope so old v2 files keep restoring;
 * per-row validation (backupStaticManifestRowSchema / bookLocationsRowSchema)
 * plus binary sanitization happen at write time in
 * BackupService.processManifest.
 *
 * Consumed by BackupService (file restore). Lives here, not in
 * BackupService, so the leaf schema can be imported without dragging the
 * backup orchestration (and its store imports) into the graph.
 */
import { z } from 'zod';

export const backupManifestEnvelopeSchema = z.looseObject({
  version: z.union([z.literal(2), z.literal(3)]),
  timestamp: z.string(),
  yjsSnapshot: z.string().min(1),
  staticManifests: z.array(z.looseObject({ bookId: z.string() })).optional(),
  locations: z.array(z.looseObject({ bookId: z.string() })).optional(),
});