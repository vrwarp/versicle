/**
 * domains/google public surface: GoogleAuthClient (per-service tokens,
 * interactive/silent split), DriveClient/DriveLibrarySync, and the GenAI
 * client family. Other domains import THIS module only (boundary rule 3).
 *
 * The barrel carries the CONSUMED surface, not every internal name — add a
 * specifier here when a consumer appears (knip flags re-exports with zero
 * consumers). In-domain code and tests import the implementation modules
 * directly.
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
export { DriveMetadataService } from './drive/DriveMetadataService';
export type { DriveIndexEntry } from './drive/DriveMetadataService';
export {
  getDriveClient,
  setDriveClient,
  getDriveLibrarySync,
  setDriveLibrarySync,
  getDriveMetadataService,
  setDriveMetadataService,
  resetDriveHoldersForTesting,
} from './drive/holder';
export type {
  DriveFile,
  DrivePreviewOutcome,
  DrivePreviewPriority,
} from './drive/types';

// --- GenAI ---
// First-use splitting: the GenAI IMPLEMENTATION is deliberately absent from
// this index's static value surface. The composition root installs the lazy
// facade (GeminiClient loads on the first generate call) and the feature
// modules load via deep dynamic imports at their call sites (e.g.
// src/app/tts/genaiPort.ts, src/hooks/useSmartTOC.ts) — static value
// re-exports here would drag them into the entry chunk (the feature modules
// carry module-scope zod schemas that defeat tree-shaking; check 4 of
// scripts/check-worker-chunk.mjs pins the emitted artifact).
export { makeLazyGenAIClient } from './genai/lazyClient';
export { MockGenAIClient, type MockGenAIFixture } from './genai/MockGenAIClient';
export { getGenAIClient, setGenAIClient } from './genai/holder';
export { type GenAILogEntry } from './genai/logging';

// --- GenAI embedding ---
// Same first-use discipline as the GenAI client: the barrel exports ONLY the
// LAZY facade + holder + contract types (never GeminiEmbeddingClient — check 4
// of scripts/check-worker-chunk.mjs pins the impl out of the entry chunk).
// MockEmbeddingClient is exported for tests only (alongside MockGenAIClient).
export { makeLazyEmbeddingClient } from './genai/embedding/lazyClient';
export { getEmbeddingClient, setEmbeddingClient } from './genai/embedding/holder';
export type {
  EmbeddingClient,
  EmbeddingConfig,
  EmbeddingProfile,
} from './genai/embedding/contract';
export { MockEmbeddingClient } from './genai/embedding/MockEmbeddingClient';
