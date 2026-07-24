/**
 * Composition holders for the Drive singletons. Constructed and installed
 * by src/app/google/wireGoogle.ts (README §2 rule 8). The DriveClient has a
 * lazy auth-holder-backed fallback; DriveLibrarySync needs store-backed
 * ports, so reading it before wiring is a programming error and throws.
 */
import { AppError } from '~types/errors';
import { getGoogleAuthClient } from '../auth/holder';
import { DriveClient } from './DriveClient';
import type { DriveLibrarySync } from './DriveLibrarySync';
import type { DriveMetadataService } from './DriveMetadataService';

let client: DriveClient | null = null;
let librarySync: DriveLibrarySync | null = null;
let metadataService: DriveMetadataService | null = null;

export function setDriveClient(instance: DriveClient): void {
  client = instance;
}

export function getDriveClient(): DriveClient {
  if (!client) {
    client = new DriveClient({ auth: getGoogleAuthClient() });
  }
  return client;
}

export function setDriveLibrarySync(instance: DriveLibrarySync): void {
  librarySync = instance;
}

export function getDriveLibrarySync(): DriveLibrarySync {
  if (!librarySync) {
    throw new AppError(
      'DriveLibrarySync is not wired — app/google/wireGoogle.ts must run first (registerAppBootTasks).',
      { code: 'APP_UNKNOWN' },
    );
  }
  return librarySync;
}

export function setDriveMetadataService(instance: DriveMetadataService): void {
  metadataService = instance;
}

export function getDriveMetadataService(): DriveMetadataService {
  if (!metadataService) {
    throw new AppError(
      'DriveMetadataService is not wired — app/google/wireGoogle.ts must run first (registerAppBootTasks).',
      { code: 'APP_UNKNOWN' },
    );
  }
  return metadataService;
}

/** Test-only: drop all singletons. */
export function resetDriveHoldersForTesting(): void {
  client = null;
  librarySync = null;
  metadataService = null;
}
