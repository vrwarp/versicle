import type { SyncManifest } from '../../../types/db';
import type { RemoteStorageProvider } from '../types';

/**
 * A mock implementation of RemoteStorageProvider for testing and offline development.
 */
export class MockDriveProvider implements RemoteStorageProvider {
  private remoteManifest: SyncManifest | null = null;
  private lastModified: number | null = null;
  private initialized = false;
  private shouldFailAuth = false;
  private shouldFailNetwork = false;
  private latency = 0;

  constructor(initialManifest?: SyncManifest) {
    // Try to load from local storage first (persistence)
    const stored = localStorage.getItem('versicle_mock_drive_data');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.remoteManifest = parsed.manifest;
        this.lastModified = parsed.lastModified;
      } catch (e) {
        console.error('Failed to load mock drive data', e);
      }
    }

    if (initialManifest) {
      this.remoteManifest = initialManifest;
      this.lastModified = Date.now();
      this.persist();
    }
  }

  private persist() {
    localStorage.setItem('versicle_mock_drive_data', JSON.stringify({
      manifest: this.remoteManifest,
      lastModified: this.lastModified
    }));
  }

  // Test helpers
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

  async initialize(_config: { clientId?: string; apiKey?: string }): Promise<void> {
    await this.simulateLatency();
    if (this.shouldFailAuth) {
      throw new Error('Mock Auth Failed');
    }
    this.initialized = true;
  }

  async isAuthenticated(): Promise<boolean> {
    return this.initialized && !this.shouldFailAuth;
  }

  async getManifest(): Promise<SyncManifest | null> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');
    return this.remoteManifest ? JSON.parse(JSON.stringify(this.remoteManifest)) : null;
  }

  async uploadManifest(manifest: SyncManifest, previousVersion?: number): Promise<void> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');

    // Simple optimistic concurrency check simulation
    if (this.remoteManifest && previousVersion !== undefined) {
      if (this.remoteManifest.version > previousVersion) {
         // In a real drive, this might be a 412.
         // For mock, we can just throw.
         throw new Error('Conflict: Remote version is newer');
      }
    }

    this.remoteManifest = JSON.parse(JSON.stringify(manifest));
    this.lastModified = Date.now();
    this.persist();
  }

  async getLastModified(): Promise<number | null> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');
    return this.lastModified;
  }
}
