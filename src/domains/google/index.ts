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
export { GeminiClient, GENAI_ROTATION_MODELS, type GeminiClientDeps } from './genai/GeminiClient';
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
export {
  generateTocTitles,
  validateTocTitles,
  type TocSectionInput,
  type TocTitleResult,
} from './genai/features/tocTitles';
export {
  detectReferenceSection,
  validateReferenceDetection,
  type ReferenceDetectionNode,
  type ReferenceDetectionResult,
  type DetectedContentType,
} from './genai/features/referenceDetection';
export {
  generateTableAdaptations,
  validateTableAdaptations,
  type TableAdaptationNode,
  type TableAdaptationResult,
} from './genai/features/tableAdaptation';
export {
  mapReadingListToLibrary,
  validateLibraryMappings,
  type UnmappedEntry,
  type UnmappedBook,
  type LibraryMapping,
} from './genai/features/libraryMapping';
