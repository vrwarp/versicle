import type { SyncManifest } from './types';

/**
 * Interface for interacting with a remote storage provider for synchronization.
 */
export interface RemoteStorageProvider {
  /**
   * Retrieves the current sync manifest from the remote storage.
   * @returns A promise resolving to the manifest and its ETag (or null if not found).
   */
  getManifest(): Promise<{ data: SyncManifest; etag: string } | null>;

  /**
   * Updates the sync manifest in the remote storage.
   * @param data The new manifest data.
   * @param etag The ETag of the version being updated (for optimistic concurrency).
   */
  updateManifest(data: SyncManifest, etag: string): Promise<void>;

  /**
   * Deletes the sync manifest from the remote storage.
   */
  deleteManifest(): Promise<void>;

  /**
   * Checks if the provider is currently authorized.
   * @returns True if authorized, false otherwise.
   */
  isAuthorized(): boolean;

  /**
   * Initiates the authorization flow.
   */
  authorize(): Promise<void>;

  /**
   * Signs out of the provider.
   */
  signOut(): Promise<void>;
}
