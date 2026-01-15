import type { RemoteStorageProvider } from '../types';

/**
 * A mock implementation of RemoteStorageProvider for testing and offline development.
 * V2: Uses Yjs binary snapshots for CRDT sync.
 */
export class MockDriveProvider implements RemoteStorageProvider {
  private remoteSnapshot: Uint8Array | null = null;
  private lastModified: number | null = null;
  private initialized = false;
  private shouldFailAuth = false;
  private shouldFailNetwork = false;
  private latency = 0;

  constructor() {
    // Try to load snapshot from local storage (persistence for testing)
    const stored = localStorage.getItem('versicle_mock_drive_snapshot');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.lastModified = parsed.lastModified;
        if (parsed.snapshotBase64) {
          const binary = atob(parsed.snapshotBase64);
          this.remoteSnapshot = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            this.remoteSnapshot[i] = binary.charCodeAt(i);
          }
        }
      } catch (e) {
        console.error('Failed to load mock drive data', e);
      }
    }
  }

  private persist() {
    let snapshotBase64: string | undefined;
    if (this.remoteSnapshot) {
      let binary = '';
      for (let i = 0; i < this.remoteSnapshot.byteLength; i++) {
        binary += String.fromCharCode(this.remoteSnapshot[i]);
      }
      snapshotBase64 = btoa(binary);
    }

    localStorage.setItem('versicle_mock_drive_snapshot', JSON.stringify({
      lastModified: this.lastModified,
      snapshotBase64
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  async uploadSnapshot(snapshot: Uint8Array): Promise<void> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');

    this.remoteSnapshot = new Uint8Array(snapshot);
    this.lastModified = Date.now();
    this.persist();
    console.log(`[MockDrive] Uploaded snapshot (${snapshot.byteLength} bytes)`);
  }

  async downloadSnapshot(): Promise<Uint8Array | null> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');

    if (this.remoteSnapshot) {
      console.log(`[MockDrive] Downloaded snapshot (${this.remoteSnapshot.byteLength} bytes)`);
      return new Uint8Array(this.remoteSnapshot);
    }
    return null;
  }

  async getLastModified(): Promise<number | null> {
    await this.simulateLatency();
    if (this.shouldFailNetwork) throw new Error('Mock Network Error');
    return this.lastModified;
  }
}
