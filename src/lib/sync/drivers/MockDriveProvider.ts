import type { SyncManifest } from '../../../types/db';
import type { RemoteStorageProvider } from '../types';

const STORAGE_KEY = 'versicle_mock_drive_data';
const META_KEY = 'versicle_mock_drive_meta';

/**
 * A mock implementation of RemoteStorageProvider for testing and offline development.
 * Persists state to localStorage so it can survive reloads and be shared across tabs (same origin).
 */
export class MockDriveProvider implements RemoteStorageProvider {
  private initialized = false;
  private shouldFailAuth = false;
  private shouldFailNetwork = false;
  private latency = 0;

  constructor(initialManifest?: SyncManifest) {
    if (initialManifest) {
      this.saveToStorage(initialManifest, Date.now());
    }
  }

  // --- Persistence Helpers ---

  private saveToStorage(manifest: SyncManifest, timestamp: number) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
      localStorage.setItem(META_KEY, timestamp.toString());
    } catch (e) {
      console.error("MockDriveProvider: Failed to save to localStorage", e);
    }
  }

  private loadFromStorage(): { manifest: SyncManifest | null; timestamp: number | null } {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      const meta = localStorage.getItem(META_KEY);
      if (data) {
        return {
          manifest: JSON.parse(data),
          timestamp: meta ? parseInt(meta, 10) : Date.now()
        };
      }
    } catch (e) {
      console.error("MockDriveProvider: Failed to read from localStorage", e);
    }
    return { manifest: null, timestamp: null };
  }

  // --- Test Helpers ---

  setMockFailure(type: 'auth' | 'network' | 'none') {
    this.shouldFailAuth = type === 'auth';
    this.shouldFailNetwork = type === 'network';
  }

  setLatency(ms: number) {
    this.latency = ms;
  }

  private async simulateLatency() {
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }
  }

  // --- Interface Implementation ---

  async initialize(_config: { clientId?: string; apiKey?: string }): Promise<void> {
    await this.simulateLatency();
    if (this.shouldFailAuth) {
      throw new Error('Mock Auth Failed');
    }
    this.initialized = true;
    console.log("MockDriveProvider initialized (Persistence: localStorage)");
  }

  async isAuthenticated(): Promise<boolean> {
    return this.initialized && !this.shouldFailAuth;
  }

  async getManifest(): Promise<SyncManifest | null> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');

    const { manifest } = this.loadFromStorage();
    // Return deep copy to prevent mutation
    return manifest ? JSON.parse(JSON.stringify(manifest)) : null;
  }

  async uploadManifest(manifest: SyncManifest, previousVersion?: number): Promise<void> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');

    const { manifest: remoteManifest } = this.loadFromStorage();

    // Simple optimistic concurrency check simulation
    if (remoteManifest && previousVersion !== undefined) {
      if (remoteManifest.version > previousVersion) {
         throw new Error('Conflict: Remote version is newer');
      }
    }

    // Save
    this.saveToStorage(manifest, Date.now());
  }

  async getLastModified(): Promise<number | null> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');
    const { timestamp } = this.loadFromStorage();
    return timestamp;
  }
}
