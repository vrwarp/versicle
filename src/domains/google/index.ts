/**
 * domains/google public surface (Phase 7 §G/§H): GoogleAuthClient (per-
 * service tokens, interactive/silent split) and DriveClient/DriveLibrarySync.
 * The GenAI + embedding family was hoisted to the provider-neutral
 * `@domains/genai` domain. Other domains import THIS module only
 * (boundary rule 3).
 *
 * P9 knip sweep: re-exports with zero consumers were pruned (the barrel
 * carries the CONSUMED surface, not every internal name — re-add a
 * specifier here when a consumer appears). In-domain code and tests import
 * the implementation modules directly.
 */
export { GoogleAuthClient } from './auth/GoogleAuthClient';
export {
  getGoogleAuthClient,
  setGoogleAuthClient,
  defaultPlatformOptions,
} from './auth/holder';
export { GOOGLE_SERVICES, type GoogleServiceId } from './auth/services';
export { GoogleAuthRequiredError } from './auth/errors';
export { DriveClient } from './drive/DriveClient';
export { DriveLibrarySync } from './drive/DriveLibrarySync';
export {
  getDriveClient,
  setDriveClient,
  getDriveLibrarySync,
  setDriveLibrarySync,
  resetDriveHoldersForTesting,
} from './drive/holder';
export type { DriveFile } from './drive/types';

// The generative-AI + embedding surface was hoisted out of this domain into
// the provider-neutral `@domains/genai` domain (it is no longer Google-only,
// now that the Anthropic/Claude provider lives alongside GeminiClient). Import
// GenAI/embedding symbols from `@domains/genai`.
