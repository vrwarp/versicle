/**
 * domains/google public surface (Phase 7 §G/§H): GoogleAuthClient (per-
 * service tokens, interactive/silent split), DriveClient/DriveLibrarySync,
 * and the GenAI client family. Other domains import THIS module only
 * (boundary rule 3).
 */
export {
  GoogleAuthClient,
  type GoogleCredential,
  type GoogleAuthClientOptions,
} from './auth/GoogleAuthClient';
export {
  getGoogleAuthClient,
  setGoogleAuthClient,
  resetGoogleAuthClientForTesting,
  defaultPlatformOptions,
} from './auth/holder';
export {
  GOOGLE_SERVICES,
  getScopesForService,
  type GoogleServiceId,
  type GoogleServiceConfig,
  type GoogleLoginOptions,
} from './auth/services';
export {
  GoogleAuthRequiredError,
  GoogleAuthRevokedError,
  GoogleAuthTransientError,
  GoogleUnknownServiceError,
} from './auth/errors';
export {
  DriveClient,
  escapeDriveQueryValue,
  type DriveRequestOptions,
} from './drive/DriveClient';
export { DriveLibrarySync, type DriveLibrarySyncPorts } from './drive/DriveLibrarySync';
export {
  getDriveClient,
  setDriveClient,
  getDriveLibrarySync,
  setDriveLibrarySync,
  resetDriveHoldersForTesting,
} from './drive/holder';
export { DriveApiError, handleDriveError } from './drive/errors';
export type { DriveFile, DriveFileIndex } from './drive/types';
