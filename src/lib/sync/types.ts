/**
 * Remote storage provider interface for cloud sync.
 * 
 * V2: Uses Yjs binary snapshots for CRDT-based sync.
 */
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
   * Uploads a Yjs state snapshot to remote storage.
   * @param snapshot Binary Yjs state from Y.encodeStateAsUpdate()
   */
  uploadSnapshot(snapshot: Uint8Array): Promise<void>;

  /**
   * Downloads the Yjs state snapshot from remote storage.
   * @returns Binary Yjs state to be applied via Y.applyUpdate(), or null if not found
   */
  downloadSnapshot(): Promise<Uint8Array | null>;

  /**
   * Returns the timestamp of the last modification on the remote file.
   * Used for quick checks to see if sync is needed.
   */
  getLastModified(): Promise<number | null>;
}
