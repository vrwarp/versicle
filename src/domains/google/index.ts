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

// --- GenAI (Phase 7 §H) ---
export {
  SchemaType,
  type GenAIClient,
  type GenAIRequest,
  type GenAIRequestContext,
  type GenAIPrompt,
  type GenAIPromptPart,
  type GenAIConfig,
  type GenAIConfigProvider,
} from './genai/contract';
// Phase 8 §A (first-use splitting): the GenAI IMPLEMENTATION left this
// index's static value surface. The composition root installs the lazy
// facade (GeminiClient loads on the first generate call) and the feature
// modules load via deep dynamic imports at their lib/genai façade call
// sites — static value re-exports here would drag them back into the
// entry chunk (the feature modules carry module-scope zod schemas that
// defeat tree-shaking; check 4 of scripts/check-worker-chunk.mjs pins the
// emitted artifact). Their TYPES remain part of this public surface;
// in-domain code and tests import the implementation modules directly.
export type { GeminiClientDeps } from './genai/GeminiClient';
export { makeLazyGenAIClient } from './genai/lazyClient';
export { MockGenAIClient, type MockGenAIFixture } from './genai/MockGenAIClient';
export { getGenAIClient, setGenAIClient, resetGenAIClientForTesting } from './genai/holder';
export {
  GenAINotConfiguredError,
  GenAIInvalidResponseError,
  GenAIHttpError,
  isResourceExhausted,
} from './genai/errors';
export {
  redactPayload,
  fnv1aHex,
  type GenAILogEntry,
  type GenAILogSink,
} from './genai/logging';
export type { TocSectionInput, TocTitleResult } from './genai/features/tocTitles';
export type {
  ReferenceDetectionNode,
  ReferenceDetectionResult,
  DetectedContentType,
} from './genai/features/referenceDetection';
export type {
  TableAdaptationNode,
  TableAdaptationResult,
} from './genai/features/tableAdaptation';
export type {
  UnmappedEntry,
  UnmappedBook,
  LibraryMapping,
} from './genai/features/libraryMapping';
