/**
 * The manual "re-upload what the cloud is missing" action behind the Sync
 * diagnostics card (see domains/sync/core/uploadMissingState.ts for why a
 * device's edits can stop reaching its peers while it still receives
 * theirs). Thin app-layer adapter over the live orchestrator.
 */
import type { UploadMissingStateResult } from '@domains/sync/core/uploadMissingState';
import { peekSyncOrchestrator } from '../createSync';

export async function repairCloudCopy(): Promise<UploadMissingStateResult> {
  const orchestrator = peekSyncOrchestrator();
  if (!orchestrator) {
    return { ok: false, error: 'Sync is not running on this device.', ms: 0 };
  }
  return orchestrator.repairUploadMissing();
}
