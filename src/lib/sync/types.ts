import type { SyncManifest } from '../../types/db';

export interface RemoteStorageProvider {
  /**
   * Initializes the provider with credentials.
   * Throws if credentials are invalid.
   */
  initialize(config: { clientId?: string; apiKey?: string }): Promise<void>;

  /**
   * Checks if the provider is ready and authenticated.
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Retrieves the latest SyncManifest from the remote storage.
   * Returns null if no manifest exists.
   */
  getManifest(): Promise<SyncManifest | null>;

  /**
   * Uploads a new SyncManifest to the remote storage.
   *
   * @param manifest The manifest to upload.
   * @param previousVersion The version of the manifest that we believe we are overwriting.
   *                        Used for optimistic concurrency control (if supported).
   */
  uploadManifest(manifest: SyncManifest, previousVersion?: number): Promise<void>;

  /**
   * Returns the timestamp of the last modification on the remote file.
   * Used for quick checks to see if sync is needed.
   */
  getLastModified(): Promise<number | null>;
}
